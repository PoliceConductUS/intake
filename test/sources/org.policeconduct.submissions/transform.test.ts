import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { transform } from "../../../sources/org/policeconduct/submissions/transform.js";
import { Artifacts } from "../../../src/shared/io/Artifacts.js";
import { buildArtifactsEnvelope } from "../../../src/cli/transform/source-transform.js";
import type {
  TransformDataContext,
  SourceManifest,
} from "../../../src/cli/transform/source-transform.js";

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
  await writeJson(path.join(submissions, "verify", `v-${submissionId}.json`), {
    verificationId: `v-${submissionId}`,
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
const data: TransformDataContext = {
  async resolveAgency({ agencyName }) {
    return agencyName === "Irving Police Department"
      ? {
          agencyId: "irving-pd",
          location: {
            address: "305 N O'Connor Rd",
            city: "Irving",
            state: "TX",
            zipCode: "75061",
          },
        }
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
): Record<string, { metadata?: { defects?: unknown[] }; spec: unknown }> {
  const artifact = manifest.artifacts.find((a) => a.kind === kind);
  expect(artifact, `missing artifact ${kind}`).toBeDefined();
  return artifact!.records;
}

describe("submissions run", () => {
  it("replaces a report symlink without writing through it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "subs-run-"));
    tempDirs.push(dir);
    const submissions = path.join(dir, "submissions");
    const state = path.join(dir, "state");
    await mkdir(submissions, { recursive: true });
    await mkdir(state, { recursive: true });
    const target = path.join(dir, "outside.json");
    await writeFile(target, "leave this alone", "utf8");
    await symlink(target, path.join(state, "review-report.json"));

    await transform({
      paths: [],
      readXlsx: (() => {
        throw new Error("unused");
      }) as never,
      state,
      emit: async () => {},
      env: { SUBMISSIONS_BUCKET_DIR: dir },
      data,
    });

    expect(await readFile(target, "utf8")).toBe("leave this alone");
    expect(
      JSON.parse(
        await readFile(path.join(state, "review-report.json"), "utf8"),
      ),
    ).toEqual({ heldOrRejected: [] });
  });

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

    const manifest = await transform({
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
    expect(review.description).toBe(
      "The submitter's account, stored verbatim.",
    );
    expect(review.submitter_relationship).toBe("Directly involved");
    expect(review.incident_date).toBe("2023-12-04");
    // Raw submitted evidence is preserved; canonical IO requires its timezone
    // before this timestamp can be filed.
    expect(() =>
      Artifacts.new(
        buildArtifactsEnvelope(
          "org/policeconduct/submissions",
          "transform",
          manifest,
        ),
      ),
    ).toThrow(/incident_date/);
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

  it("falls back to the resolved officer's agency address when the incident location is too vague", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "subs-run-"));
    tempDirs.push(dir);
    const submissions = path.join(dir, "submissions");
    const state = path.join(dir, "state");
    await mkdir(state, { recursive: true });

    // "Irving city jail" has no parseable city/state/zip — not geocodable on its
    // own — but the officer resolves, so the report anchors to the agency address.
    await verifiedReport(submissions, "vague-loc", {
      title: "Jail conditions",
      description: "Held overnight.",
      location: "Irving city jail",
      "officers[0][name]": "James Markham",
      "officers[0][department]": "Irving Police Department",
    });
    await writeJson(path.join(submissions, "status", "vague-loc.json"), {
      submissionId: "vague-loc",
      status: "approved",
    });

    const manifest = await transform({
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
    expect(Object.keys(reviews)).toEqual(["vague-loc"]);
    const review = reviews["vague-loc"]!.spec as Record<string, unknown>;
    // The agency's address supplies the geocodable location.
    expect(review.address).toBe("305 N O'Connor Rd");
    expect(review.city).toBe("Irving");
    expect(review.state).toBe("TX");
    expect(review.zip_code).toBe("75061");
    expect(Object.keys(records(manifest, "ReviewPersonnel"))).toEqual([
      "vague-loc|ap-markham",
    ]);
  });

  it("fails loud when SUBMISSIONS_BUCKET_DIR is missing", async () => {
    await expect(
      transform({
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

const OFFICER_MARKHAM = {
  "officers[0][name]": "James Markham",
  "officers[0][department]": "Irving Police Department",
};

async function bucket(): Promise<{
  dir: string;
  submissions: string;
  state: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "subs-run-"));
  tempDirs.push(dir);
  const submissions = path.join(dir, "submissions");
  const state = path.join(dir, "state");
  await mkdir(submissions, { recursive: true });
  await mkdir(state, { recursive: true });
  return { dir, submissions, state };
}

async function approve(
  submissions: string,
  submissionId: string,
): Promise<void> {
  await writeJson(path.join(submissions, "status", `${submissionId}.json`), {
    submissionId,
    status: "approved",
  });
}

function run(
  dir: string,
  state: string,
  context: TransformDataContext = data,
  logged: string[] = [],
): Promise<SourceManifest> {
  return transform({
    paths: [],
    readXlsx: (() => {
      throw new Error("unused");
    }) as never,
    state,
    emit: async () => {},
    env: { SUBMISSIONS_BUCKET_DIR: dir },
    data: context,
    logger: { info: (line: string) => logged.push(line) } as never,
  });
}

describe("submissions row accounting", () => {
  it("gives every submission, verify record and status record one outcome", async () => {
    const { dir, submissions, state } = await bucket();
    await verifiedReport(submissions, "approved-ok", {
      title: "Emitted",
      location: "5910 N MacArthur Blvd, Irving, TX 75039",
      ...OFFICER_MARKHAM,
    });
    await approve(submissions, "approved-ok");
    await verifiedReport(submissions, "approved-no-officer", {
      title: "Unmatched officer",
      location: "Somewhere, TX 70000",
      "officers[0][name]": "Nobody Known",
      "officers[0][department]": "Nowhere Police Department",
    });
    await approve(submissions, "approved-no-officer");
    await verifiedReport(submissions, "no-verdict", { title: "Waiting" });
    await verifiedReport(submissions, "rejected-one", { title: "Rejected" });
    await writeJson(path.join(submissions, "status", "rejected-one.json"), {
      submissionId: "rejected-one",
      status: "rejected",
    });
    await verifiedReport(submissions, "in-review", { title: "In review" });
    await writeJson(path.join(submissions, "status", "v-in-review.json"), {
      verificationId: "v-in-review",
      status: "in_review",
      statusChangedAt: "2026-01-03T00:00:00Z",
    });
    await verifiedReport(submissions, "unverified", { title: "Unverified" });
    await writeJson(path.join(submissions, "verify", "v-unverified.json"), {
      verificationId: "v-unverified",
      submissionId: "unverified",
      formName: "reportNew",
      verifiedAt: null,
    });
    await writeJson(path.join(submissions, "status", "unverified.json"), {
      submissionId: "unverified",
      status: "received",
    });
    await writeJson(
      path.join(submissions, "2026-01-01", "reportNew", "no-verify.json"),
      {
        submissionId: "no-verify",
        receivedAt: "2026-01-01T09:00:00Z",
        payload: { formName: "reportNew", data: { title: "No verify record" } },
      },
    );
    await writeJson(
      path.join(submissions, "2026-01-01", "contact", "c1.json"),
      {
        submissionId: "c1",
        receivedAt: "2026-01-01T09:00:00Z",
        payload: { formName: "contact", data: {} },
      },
    );
    await writeJson(path.join(submissions, "verify", "v-c1.json"), {
      verificationId: "v-c1",
      submissionId: "c1",
      formName: "contact",
      verifiedAt: "2026-01-02T00:00:00Z",
    });
    await writeJson(path.join(submissions, "status", "v-c1.json"), {
      verificationId: "v-c1",
      status: "in_review",
    });
    await writeJson(
      path.join(submissions, "2026-01-01", "personnelNew", "p1.json"),
      {
        submissionId: "p1",
        receivedAt: "2026-01-01T09:00:00Z",
        payload: { formName: "personnelNew", data: {} },
      },
    );
    await writeJson(path.join(submissions, "status", "p1.json"), {
      submissionId: "p1",
      status: "received",
    });

    const manifest = await run(dir, state);

    expect(Object.keys(records(manifest, "Reviews"))).toEqual(["approved-ok"]);
    expect(manifest.accounting).toEqual([
      {
        input: "reportNew submissions",
        read: 7,
        emitted: 1,
        reported: 0,
        notSelected: {
          "not verified": 2,
          rejected: 1,
          "held: no verdict": 1,
          "held: in_review": 1,
          "held: approved but no officer resolved": 1,
        },
      },
      {
        input: "verify records",
        read: 7,
        emitted: 1,
        reported: 0,
        notSelected: {
          "other form": 1,
          "not verified": 1,
          rejected: 1,
          "held: no verdict": 1,
          "held: in_review": 1,
          "held: approved but no officer resolved": 1,
        },
      },
      {
        input: "status records",
        read: 7,
        emitted: 1,
        reported: 0,
        notSelected: {
          "other form": 2,
          "not verified": 1,
          rejected: 1,
          "held: in_review": 1,
          "held: approved but no officer resolved": 1,
        },
      },
    ]);
  });

  it("reads a missing verify folder and a missing status folder as no records", async () => {
    const { dir, submissions, state } = await bucket();
    await writeJson(
      path.join(submissions, "2026-01-01", "reportNew", "alone.json"),
      {
        submissionId: "alone",
        receivedAt: "2026-01-01T09:00:00Z",
        payload: { formName: "reportNew", data: { title: "Alone" } },
      },
    );
    const manifest = await run(dir, state);
    expect(manifest.accounting).toEqual([
      {
        input: "reportNew submissions",
        read: 1,
        emitted: 0,
        reported: 0,
        notSelected: { "not verified": 1 },
      },
      {
        input: "verify records",
        read: 0,
        emitted: 0,
        reported: 0,
        notSelected: {},
      },
      {
        input: "status records",
        read: 0,
        emitted: 0,
        reported: 0,
        notSelected: {},
      },
    ]);
  });
});

describe("submissions findings", () => {
  it("emits the review for the resolved officer with a finding for each officer left off", async () => {
    const { dir, submissions, state } = await bucket();
    await verifiedReport(submissions, "two-officers", {
      title: "Two officers",
      location: "5910 N MacArthur Blvd, Irving, TX 75039",
      "officers[0][name]": "Zebulon Quartermain",
      "officers[0][department]": "Irving Police Department",
      "officers[1][name]": "James Markham",
      "officers[1][department]": "Irving Police Department",
      "officers[2][name]": "Hezekiah Thistlewood",
      "officers[2][department]": "Xanadu Marshal Office",
      "officers[3][name]": "Ignatius Farthingale",
      "officers[3][department]": "",
    });
    await approve(submissions, "two-officers");
    const logged: string[] = [];

    const manifest = await run(dir, state, data, logged);

    expect(Object.keys(records(manifest, "ReviewPersonnel"))).toEqual([
      "two-officers|ap-markham",
    ]);
    const finding = {
      type: "warning",
      value: null,
      source_namespace: "org/policeconduct/submissions",
      source_record_id: "two-officers",
    };
    const file = "submissions/2026-01-01/reportNew/two-officers.json";
    expect(records(manifest, "Reviews")["two-officers"]!.metadata).toEqual({
      defects: [
        {
          ...finding,
          code: "officer-not-on-agency-roster",
          field: "officers[0]",
          message:
            "An officer named in this report is not linked to it, because no officer with that name is on the roster of the agency the report gives.",
          evidence: [{ file, officer: 1 }],
        },
        {
          ...finding,
          code: "officer-agency-not-found",
          field: "officers[2]",
          message:
            "An officer named in this report is not linked to it, because the agency the report gives for that officer is not one this site lists.",
          evidence: [{ file, officer: 3 }],
        },
        {
          ...finding,
          code: "officer-name-or-agency-blank",
          field: "officers[3]",
          message:
            "An officer named in this report is not linked to it, because the report gives no name or no agency for that officer.",
          evidence: [{ file, officer: 4 }],
        },
      ],
    });
    const visible = JSON.stringify([
      records(manifest, "Reviews")["two-officers"]!.metadata,
      logged,
    ]);
    for (const text of [
      "Quartermain",
      "Thistlewood",
      "Xanadu",
      "Farthingale",
      "MacArthur",
    ])
      expect(visible).not.toContain(text);
    expect(manifest.accounting[0]).toEqual({
      input: "reportNew submissions",
      read: 1,
      emitted: 1,
      reported: 0,
      notSelected: {},
    });
  });

  it("emits a review with an empty finding list when every officer resolves", async () => {
    const { dir, submissions, state } = await bucket();
    await verifiedReport(submissions, "clean", {
      title: "Clean",
      location: "5910 N MacArthur Blvd, Irving, TX 75039",
      ...OFFICER_MARKHAM,
    });
    await approve(submissions, "clean");
    const manifest = await run(dir, state);
    expect(records(manifest, "Reviews")["clean"]!.metadata).toEqual({
      defects: [],
    });
  });

  it("reports a finding when the agency address replaces a location that cannot be placed", async () => {
    const { dir, submissions, state } = await bucket();
    await verifiedReport(submissions, "vague", {
      title: "Vague",
      location: "Behind the Wobblethorpe laundromat",
      ...OFFICER_MARKHAM,
    });
    await approve(submissions, "vague");
    const manifest = await run(dir, state);
    const review = records(manifest, "Reviews")["vague"]!;
    expect((review.spec as { address: string }).address).toBe(
      "305 N O'Connor Rd",
    );
    expect(review.metadata).toEqual({
      defects: [
        {
          code: "location-replaced-by-agency-address",
          type: "warning",
          field: "address",
          value: null,
          message:
            "The location given in this report could not be placed on a map, so the report is shown at the address of the officer's agency.",
          evidence: [{ file: "submissions/2026-01-01/reportNew/vague.json" }],
          source_namespace: "org/policeconduct/submissions",
          source_record_id: "vague",
        },
      ],
    });
    expect(JSON.stringify(review.metadata)).not.toContain("Wobblethorpe");
  });
});

describe("submissions review report", () => {
  it("holds a report with no usable location under a reason code that has no submitter text", async () => {
    const { dir, submissions, state } = await bucket();
    await verifiedReport(submissions, "nowhere", {
      title: "Nowhere",
      location: "Behind the Wobblethorpe laundromat",
      ...OFFICER_MARKHAM,
    });
    await approve(submissions, "nowhere");
    const logged: string[] = [];
    const manifest = await run(
      dir,
      state,
      {
        resolveAgency: async () => ({ agencyId: "irving-pd" }),
        resolvePersonnel: data.resolvePersonnel,
      },
      logged,
    );
    expect(records(manifest, "Reviews")).toEqual({});
    const report = await readFile(
      path.join(state, "review-report.json"),
      "utf8",
    );
    expect(JSON.parse(report)).toEqual({
      heldOrRejected: [
        {
          submissionId: "nowhere",
          title: "Nowhere",
          reason: "approved but location not geocodable",
        },
      ],
    });
    expect(report + logged.join("\n")).not.toContain("Wobblethorpe");
    expect(manifest.accounting[0]!.notSelected).toEqual({
      "held: approved but location not geocodable": 1,
    });
  });
});

describe("submissions inputs that good data cannot have", () => {
  async function oneReport(): Promise<{
    dir: string;
    submissions: string;
    state: string;
  }> {
    const made = await bucket();
    await verifiedReport(made.submissions, "one", {
      title: "One",
      location: "5910 N MacArthur Blvd, Irving, TX 75039",
      ...OFFICER_MARKHAM,
    });
    await approve(made.submissions, "one");
    return made;
  }

  it("fails when the data context cannot resolve an agency", async () => {
    const { dir, state } = await oneReport();
    await expect(
      run(dir, state, { resolvePersonnel: data.resolvePersonnel }),
    ).rejects.toThrow(/resolveAgency/);
  });

  for (const folder of ["verify", "status"]) {
    it(`fails when the ${folder} folder cannot be listed`, async () => {
      const { dir, submissions, state } = await bucket();
      await writeFile(path.join(submissions, folder), "not a folder", "utf8");
      await expect(run(dir, state)).rejects.toThrow(/ENOTDIR/);
    });
  }

  it("fails when a reportNew folder cannot be listed", async () => {
    const { dir, submissions, state } = await bucket();
    await mkdir(path.join(submissions, "2026-01-01"));
    await writeFile(
      path.join(submissions, "2026-01-01", "reportNew"),
      "not a folder",
      "utf8",
    );
    await expect(run(dir, state)).rejects.toThrow(/ENOTDIR/);
  });

  it("fails on a verify record with a key the schema does not declare", async () => {
    const { dir, submissions, state } = await oneReport();
    await writeJson(path.join(submissions, "verify", "v-one.json"), {
      verificationId: "v-one",
      submissionId: "one",
      formName: "reportNew",
      verifiedAt: "2026-01-02T00:00:00Z",
      surprise: true,
    });
    await expect(run(dir, state)).rejects.toThrow(
      /org\/policeconduct\/submissions: .*verify\/v-one\.json.*surprise/,
    );
  });

  it("fails on a verify record with no submissionId", async () => {
    const { dir, submissions, state } = await oneReport();
    await writeJson(path.join(submissions, "verify", "v-bad.json"), {
      verificationId: "v-bad",
      formName: "reportNew",
      verifiedAt: null,
    });
    await expect(run(dir, state)).rejects.toThrow(
      /verify\/v-bad\.json.*submissionId/,
    );
  });

  it("fails on a status record with no status", async () => {
    const { dir, submissions, state } = await oneReport();
    await writeJson(path.join(submissions, "status", "one.json"), {
      submissionId: "one",
    });
    await expect(run(dir, state)).rejects.toThrow(/status\/one\.json.*status/);
  });

  it("fails on a status record with a key the schema does not declare", async () => {
    const { dir, submissions, state } = await oneReport();
    await writeJson(path.join(submissions, "status", "one.json"), {
      submissionId: "one",
      status: "approved",
      verdict: "approved",
    });
    await expect(run(dir, state)).rejects.toThrow(/status\/one\.json.*verdict/);
  });

  it("fails on a status record that names neither a submission nor a verification", async () => {
    const { dir, submissions, state } = await oneReport();
    await writeJson(path.join(submissions, "status", "loose.json"), {
      status: "approved",
    });
    await expect(run(dir, state)).rejects.toThrow(/status\/loose\.json/);
  });

  it("fails on a status record that matches no submission", async () => {
    const { dir, submissions, state } = await oneReport();
    await writeJson(path.join(submissions, "status", "ghost.json"), {
      submissionId: "ghost",
      status: "approved",
    });
    await expect(run(dir, state)).rejects.toThrow(
      "org/policeconduct/submissions: status record status/ghost.json matches no submission.",
    );
  });

  it("fails on a status record whose verification has no verify record", async () => {
    const { dir, submissions, state } = await oneReport();
    await writeJson(path.join(submissions, "status", "v-ghost.json"), {
      verificationId: "v-ghost",
      status: "in_review",
    });
    await expect(run(dir, state)).rejects.toThrow(
      "org/policeconduct/submissions: status record status/v-ghost.json names a verification that has no verify record.",
    );
  });

  it("fails on two status records for one submission", async () => {
    const { dir, submissions, state } = await oneReport();
    await writeJson(path.join(submissions, "status", "v-one.json"), {
      verificationId: "v-one",
      status: "rejected",
    });
    await expect(run(dir, state)).rejects.toThrow(
      "org/policeconduct/submissions: status records status/one.json and status/v-one.json are for one submission.",
    );
  });

  it("fails on two verify records for one submission", async () => {
    const { dir, submissions, state } = await oneReport();
    await writeJson(path.join(submissions, "verify", "v-again.json"), {
      verificationId: "v-again",
      submissionId: "one",
      formName: "reportNew",
      verifiedAt: null,
    });
    await expect(run(dir, state)).rejects.toThrow(
      "org/policeconduct/submissions: verify records verify/v-again.json and verify/v-one.json are for one submission.",
    );
  });

  it("fails on two verify records with one verificationId", async () => {
    const { dir, submissions, state } = await oneReport();
    await writeJson(path.join(submissions, "verify", "copy.json"), {
      verificationId: "v-one",
      submissionId: "other",
      formName: "contact",
      verifiedAt: null,
    });
    await expect(run(dir, state)).rejects.toThrow(
      "org/policeconduct/submissions: verify records verify/copy.json and verify/v-one.json hold one verificationId.",
    );
  });

  it("fails on a reportNew verify record with no reportNew submission", async () => {
    const { dir, submissions, state } = await oneReport();
    await writeJson(path.join(submissions, "verify", "v-ghost.json"), {
      verificationId: "v-ghost",
      submissionId: "ghost",
      formName: "reportNew",
      verifiedAt: "2026-01-02T00:00:00Z",
    });
    await expect(run(dir, state)).rejects.toThrow(
      "org/policeconduct/submissions: verify record verify/v-ghost.json is for a reportNew submission that is in no reportNew folder.",
    );
  });

  it("fails on a verify record that gives another form for a reportNew submission", async () => {
    const { dir, submissions, state } = await oneReport();
    await writeJson(path.join(submissions, "verify", "v-one.json"), {
      verificationId: "v-one",
      submissionId: "one",
      formName: "contact",
      verifiedAt: "2026-01-02T00:00:00Z",
    });
    await expect(run(dir, state)).rejects.toThrow(
      "org/policeconduct/submissions: verify record verify/v-one.json is not for the reportNew form, but its submission is in a reportNew folder.",
    );
  });
});
