import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { readSubmissions } from "../../../../../sources/org/policeconduct/submissions/submissions.js";

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

  // s1: a verified reportNew. s2: reportNew but unverified.
  await writeJson(path.join(submissions, "verify", "v1.json"), {
    verificationId: "v1",
    submissionId: "s1",
    formName: "reportNew",
    verifiedAt: "2026-01-02T00:00:00Z",
  });
  await writeJson(path.join(submissions, "verify", "v2.json"), {
    verificationId: "v2",
    submissionId: "s2",
    formName: "reportNew",
    verifiedAt: null,
    email: "jane@example.com",
    secretHash: "c2VjcmV0",
  });
  await writeJson(path.join(submissions, "status", "s1.json"), {
    submissionId: "s1",
    status: "approved",
    decision: { at: "2026-01-03T00:00:00Z", by: "curator", reason: "Clear." },
  });
  await writeJson(path.join(submissions, "status", "v2.json"), {
    verificationId: "v2",
    status: "in_review",
    statusChangedAt: "2026-01-03T00:00:00Z",
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

  // A different form on the same day: only its submission ID is taken.
  await writeJson(path.join(submissions, "2026-01-01", "contact", "c1.json"), {
    submissionId: "c1",
    receivedAt: "2026-01-01T09:00:00Z",
    payload: { formName: "contact", data: {} },
  });

  return submissions;
}

describe("readSubmissions", () => {
  it("returns every reportNew submission by receipt, parsed without PII or traits", async () => {
    const { reports } = await readSubmissions(await bucket());

    expect(reports.map((r) => r.submissionId)).toEqual(["s1", "s2"]);
    expect(reports.map((r) => r.file)).toEqual([
      "2026-01-01/reportNew/s1.json",
      "2026-01-01/reportNew/s2.json",
    ]);
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

  it("de-flattens form-encoded officers (officers[N][field]) into the nested array", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "subs-"));
    tempDirs.push(dir);
    const submissions = path.join(dir, "submissions");
    await writeJson(path.join(submissions, "verify", "v1.json"), {
      verificationId: "v1",
      submissionId: "flat1",
      formName: "reportNew",
      verifiedAt: "2026-01-02T00:00:00Z",
    });
    // The real bucket format: officers arrive as flat form keys, not an array.
    await writeJson(
      path.join(submissions, "2026-01-01", "reportNew", "flat1.json"),
      reportEnvelope("flat1", "2026-01-01T10:00:00Z", {
        title: "Flat",
        "officers[0][name]": "James Markham",
        "officers[0][badge]": "1379",
        "officers[0][department]": "Irving Police Department",
        "officers[1][name]": "Andrew Hammett",
        "officers[1][badge]": "1263",
        "officers[1][department]": "Irving Police Department",
      }),
    );

    const [report] = (await readSubmissions(submissions)).reports;
    expect(report.officers).toEqual([
      {
        name: "James Markham",
        badge: "1379",
        department: "Irving Police Department",
      },
      {
        name: "Andrew Hammett",
        badge: "1263",
        department: "Irving Police Department",
      },
    ]);
  });

  it("returns the verify and status records without the fields it does not use, and the IDs of other forms", async () => {
    const read = await readSubmissions(await bucket());
    expect(read.verifyRecords).toEqual([
      {
        file: "verify/v1.json",
        verificationId: "v1",
        submissionId: "s1",
        formName: "reportNew",
        verified: true,
      },
      {
        file: "verify/v2.json",
        verificationId: "v2",
        submissionId: "s2",
        formName: "reportNew",
        verified: false,
      },
    ]);
    expect(read.statusRecords).toEqual([
      { file: "status/s1.json", submissionId: "s1", status: "approved" },
      { file: "status/v2.json", verificationId: "v2", status: "in_review" },
    ]);
    expect([...read.otherFormSubmissionIds]).toEqual(["c1"]);
  });

  it("fails when payload.formName is not the name of the folder", async () => {
    const submissions = await bucket();
    await writeJson(
      path.join(submissions, "2026-01-02", "reportNew", "s3.json"),
      {
        submissionId: "s3",
        receivedAt: "2026-01-02T10:00:00Z",
        payload: { formName: "contact", data: { title: "Misfiled" } },
      },
    );
    await expect(readSubmissions(submissions)).rejects.toThrow(
      `org/policeconduct/submissions: ${path.join(submissions, "2026-01-02", "reportNew", "s3.json")} is in a reportNew folder but its payload.formName is not reportNew.`,
    );
  });

  it("fails when two reportNew files hold one submissionId", async () => {
    const submissions = await bucket();
    await writeJson(
      path.join(submissions, "2026-01-02", "reportNew", "copy.json"),
      reportEnvelope("s1", "2026-01-02T10:00:00Z", { title: "Copy" }),
    );
    await expect(readSubmissions(submissions)).rejects.toThrow(
      "org/policeconduct/submissions: 2026-01-01/reportNew/s1.json and 2026-01-02/reportNew/copy.json hold one submissionId.",
    );
  });

  it("names the file and no file content when a submission is not JSON", async () => {
    const submissions = await bucket();
    const file = path.join(submissions, "2026-01-02", "reportNew", "bad.json");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "Wobblethorpe wrote this", "utf8");
    const error = await readSubmissions(submissions).then(
      () => undefined,
      (thrown: Error) => thrown,
    );
    expect(error?.message).toBe(
      `org/policeconduct/submissions: ${file} is not valid JSON.`,
    );
  });

  it("names the file and the field when a submission does not fit the schema", async () => {
    const submissions = await bucket();
    const file = path.join(submissions, "2026-01-02", "reportNew", "odd.json");
    await writeJson(
      file,
      reportEnvelope("odd", "2026-01-02T10:00:00Z", { title: 7 }),
    );
    const error = await readSubmissions(submissions).then(
      () => undefined,
      (thrown: Error) => thrown,
    );
    expect(error?.message).toContain(
      `org/policeconduct/submissions: ${file} is not a valid reportNew submission: `,
    );
    expect(error?.message).toContain("title");
  });
});
