import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { readVerifiedReportSubmissions } from "../../../sources/org.policeconduct.submissions/submissions.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true })));
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value), "utf8");
}

function reportEnvelope(
  submissionId: string,
  receivedAt: string,
  data: Record<string, unknown>,
) {
  return {
    submissionId,
    receivedAt,
    sourceIp: "203.0.113.7",
    userAgent: "Mozilla/5.0",
    payload: {
      formName: "reportNew",
      data: { "form-name": "reportNew", ...data },
    },
  };
}

async function bucket(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "subs-"));
  tempDirs.push(dir);
  const submissions = path.join(dir, "submissions");

  // s1: a verified reportNew (included). s2: reportNew but unverified (excluded).
  await writeJson(path.join(submissions, "verify", "v1.json"), {
    submissionId: "s1",
    formName: "reportNew",
    verifiedAt: "2026-01-02T00:00:00Z",
  });
  await writeJson(path.join(submissions, "verify", "v2.json"), {
    submissionId: "s2",
    formName: "reportNew",
    verifiedAt: "",
  });

  await writeJson(
    path.join(submissions, "2026-01-01", "reportNew", "s1.json"),
    reportEnvelope("s1", "2026-01-01T10:00:00Z", {
      title: "Stop on Main St",
      description: "What happened.",
      location: "Palestine",
      outcome: "Accountability",
      charges: "none",
      incidentDate: "2025-12-30",
      relationship: "firsthand",
      officers: [
        {
          name: "J. Smith",
          badge: "4412",
          department: "Palestine Police Department",
          traits: { professionalism: 2 },
        },
      ],
      reporterName: "Jane Doe",
      reporterEmail: "jane@example.com",
    }),
  );
  await writeJson(
    path.join(submissions, "2026-01-01", "reportNew", "s2.json"),
    reportEnvelope("s2", "2026-01-01T11:00:00Z", { title: "Unverified" }),
  );

  // A different form on the same day is ignored entirely.
  await writeJson(path.join(submissions, "2026-01-01", "contact", "c1.json"), {
    submissionId: "c1",
    receivedAt: "2026-01-01T09:00:00Z",
    payload: { formName: "contact", data: {} },
  });

  return submissions;
}

describe("readVerifiedReportSubmissions", () => {
  it("returns only verified reportNew submissions, parsed without PII or traits", async () => {
    const reports = await readVerifiedReportSubmissions(await bucket());

    expect(reports.map((r) => r.submissionId)).toEqual(["s1"]);
    const [report] = reports;
    expect(report.title).toBe("Stop on Main St");
    expect(report.location).toBe("Palestine");
    expect(report.relationship).toBe("firsthand");
    expect(report.officers).toEqual([
      {
        name: "J. Smith",
        badge: "4412",
        department: "Palestine Police Department",
      },
    ]);
    // Neither submitter PII nor the deprecated traits survive the parse.
    const asJson = JSON.stringify(report);
    expect(asJson).not.toContain("jane@example.com");
    expect(asJson).not.toContain("Jane Doe");
    expect(asJson).not.toContain("traits");
    expect(asJson).not.toContain("sourceIp");
  });
});
