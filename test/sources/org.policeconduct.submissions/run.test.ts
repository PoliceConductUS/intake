import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { run } from "../../../sources/org.policeconduct.submissions/run.js";
import type {
  RunDataContext,
  SourceManifest,
} from "../../../src/cli/run/source-run.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value), "utf8");
}

async function verifiedReport(
  submissions: string,
  submissionId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await writeJson(path.join(submissions, "verify", `${submissionId}.json`), {
    submissionId,
    formName: "reportNew",
    verifiedAt: "2026-01-02T00:00:00Z",
  });
  await writeJson(
    path.join(submissions, "2026-01-01", "reportNew", `${submissionId}.json`),
    {
      submissionId,
      receivedAt: `2026-01-01T10:00:0${submissionId.length}Z`,
      payload: { formName: "reportNew", data },
    },
  );
}

// The roster only knows officer "James Markham" at "Irving Police Department";
// everything else is unresolved, so an approved report naming only unknown
// officers is held, not published.
const data: RunDataContext = {
  async resolveAgency({ agencyName }) {
    return agencyName === "Irving Police Department"
      ? { agencyId: "irving-pd" }
      : null;
  },
  async resolvePersonnel({ agencyId, personnelName }) {
    return agencyId === "irving-pd" && personnelName === "James Markham"
      ? { agencyPersonnelId: "ap-markham" }
      : null;
  },
};

function records(
  manifest: SourceManifest,
  kind: string,
): Record<string, { spec: unknown }> {
  const artifact = manifest.artifacts.find((a) => a.kind === kind);
  expect(artifact, `missing artifact ${kind}`).toBeDefined();
  return artifact!.records;
}

describe("submissions run", () => {
  it("publishes only approved, officer-resolved reports and holds the rest", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "subs-run-"));
    tempDirs.push(dir);
    const submissions = path.join(dir, "submissions");
    const state = path.join(dir, "state");
    await mkdir(state, { recursive: true });

    await verifiedReport(submissions, "approved-ok", {
      title: "First Amendment retaliation arrest",
      description: "The submitter's account, stored verbatim.",
      location: "5910 N MacArthur Blvd, Irving, TX 75039",
      outcome: "Accountability",
      charges: "",
      incidentDate: "2023-12-04",
      relationship: "Directly involved",
      "officers[0][name]": "James Markham",
      "officers[0][badge]": "1379",
      "officers[0][department]": "Irving Police Department",
    });
    await verifiedReport(submissions, "approved-no-officer", {
      title: "Unmatched officer",
      description: "Named officer is not in the roster.",
      location: "Somewhere, TX 70000",
      "officers[0][name]": "Nobody Known",
      "officers[0][department]": "Nowhere Police Department",
    });
    await verifiedReport(submissions, "no-verdict", {
      title: "Awaiting review",
      description: "No status file exists for this one.",
      location: "Elsewhere, TX",
    });
    await verifiedReport(submissions, "rejected-one", {
      title: "Rejected",
      description: "Permanently excluded.",
      location: "Nowhere, TX",
      "officers[0][name]": "James Markham",
      "officers[0][department]": "Irving Police Department",
    });

    await writeJson(path.join(submissions, "status", "approved-ok.json"), {
      submissionId: "approved-ok",
      status: "approved",
    });
    await writeJson(
      path.join(submissions, "status", "approved-no-officer.json"),
      { submissionId: "approved-no-officer", status: "approved" },
    );
    await writeJson(path.join(submissions, "status", "rejected-one.json"), {
      submissionId: "rejected-one",
      status: "rejected",
    });

    const manifest = await run({
      paths: [],
      readXlsx: (() => {
        throw new Error("unused");
      }) as never,
      state,
      emit: async () => {},
      env: { SUBMISSIONS_BUCKET_DIR: dir },
      data,
    });

    const reviews = records(manifest, "Reviews");
    const reviewPersonnel = records(manifest, "ReviewPersonnel");

    // Only the approved, officer-resolved report publishes.
    expect(Object.keys(reviews)).toEqual(["approved-ok"]);
    const review = reviews["approved-ok"]!.spec as Record<string, unknown>;
    expect(review.id).toBe("approved-ok");
    expect(review.title).toBe("First Amendment retaliation arrest");
    // Submitter prose is stored verbatim (ADR 0029).
    expect(review.description).toBe("The submitter's account, stored verbatim.");
    expect(review.submitter_relationship).toBe("Directly involved");
    expect(review.incident_date).toBe("2023-12-04");
    // The free-text location yields geocode hints for the Review facade.
    expect(review.address).toBe("5910 N MacArthur Blvd, Irving, TX 75039");
    expect(review.city).toBe("Irving");
    expect(review.state).toBe("TX");
    expect(review.zip_code).toBe("75039");

    expect(Object.keys(reviewPersonnel)).toEqual(["approved-ok|ap-markham"]);
    expect(reviewPersonnel["approved-ok|ap-markham"]!.spec).toEqual({
      review_id: "approved-ok",
      agency_personnel_id: "ap-markham",
    });

    // Held/rejected reasons are reported; the rejected one is excluded entirely.
    const report = JSON.parse(
      await readFile(path.join(state, "review-report.json"), "utf8"),
    ) as { heldOrRejected: { submissionId: string; reason: string }[] };
    const held = new Map(
      report.heldOrRejected.map((h) => [h.submissionId, h.reason]),
    );
    expect(held.get("approved-no-officer")).toBe(
      "approved but no officer resolved",
    );
    expect(held.get("no-verdict")).toBe("no verdict");
    expect(held.has("rejected-one")).toBe(false);
    expect(held.has("approved-ok")).toBe(false);
  });

  it("fails loud when SUBMISSIONS_BUCKET_DIR is missing", async () => {
    await expect(
      run({
        paths: [],
        readXlsx: (() => {
          throw new Error("unused");
        }) as never,
        state: tmpdir(),
        emit: async () => {},
        env: {},
        data,
      }),
    ).rejects.toThrow(/SUBMISSIONS_BUCKET_DIR/);
  });
});
