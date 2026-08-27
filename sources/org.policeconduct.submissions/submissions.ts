import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// The bucket layout (ADR 0030): submissions/<date>/<formName>/<id>.json, plus
// submissions/verify/<verificationId>.json (email verification) and
// submissions/status/. A submission is VERIFIED when its verify record has a
// non-empty verifiedAt. v1 handles the reportNew form only.
const REPORT_FORM = "reportNew";

// One officer named in a report. The submission's `traits` (the retired rubric
// model) is deprecated and ignored — never read, never persisted.
export type OfficerRef = {
  name: string;
  badge: string;
  department: string;
};

// A parsed, verified report submission — the source's field contract. Submitter
// PII (reporterName/Email/Phone, sourceIp, userAgent) is intentionally absent: it
// is never read into the record (ADR 0029 §3).
export type ReportSubmission = {
  submissionId: string;
  receivedAt: string;
  title: string;
  description: string;
  location: string;
  officers: OfficerRef[];
  outcome: string;
  charges: string;
  incidentDate: string;
  relationship: string;
};

// traits (deprecated rubric model) is left in passthrough and never surfaced.
const OfficerSchema = z
  .object({
    name: z.string().default(""),
    badge: z.string().default(""),
    department: z.string().default(""),
  })
  .passthrough();

// Content-lenient (user fields may be blank; coherence is gated later in run) but
// object-shaped: a data payload that is not an object is a malformed report.
const ReportDataSchema = z
  .object({
    title: z.string().default(""),
    description: z.string().default(""),
    location: z.string().default(""),
    officers: z.array(OfficerSchema).default([]),
    outcome: z.string().default(""),
    charges: z.string().default(""),
    incidentDate: z.string().default(""),
    relationship: z.string().default(""),
  })
  .passthrough();

const EnvelopeSchema = z
  .object({
    submissionId: z.string(),
    receivedAt: z.string(),
    payload: z.object({
      formName: z.string(),
      data: z.unknown(),
    }),
  })
  .passthrough();

const VerifySchema = z
  .object({
    submissionId: z.string(),
    formName: z.string(),
    verifiedAt: z.string().nullish(),
  })
  .passthrough();

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `org.policeconduct.submissions: cannot read ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// The submissionIds whose reportNew submission has a verified email.
async function verifiedReportIds(submissionsDir: string): Promise<Set<string>> {
  const verifyDir = path.join(submissionsDir, "verify");
  const files = await readdir(verifyDir).catch(() => [] as string[]);
  const ids = new Set<string>();
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const record = VerifySchema.parse(
      await readJson(path.join(verifyDir, file)),
    );
    if (
      record.formName === REPORT_FORM &&
      record.verifiedAt !== null &&
      record.verifiedAt !== undefined &&
      record.verifiedAt !== ""
    ) {
      ids.add(record.submissionId);
    }
  }
  return ids;
}

function toReportSubmission(envelope: unknown): ReportSubmission {
  const parsed = EnvelopeSchema.parse(envelope);
  const data = ReportDataSchema.parse(parsed.payload.data);
  return {
    submissionId: parsed.submissionId,
    receivedAt: parsed.receivedAt,
    title: data.title,
    description: data.description,
    location: data.location,
    officers: data.officers.map((officer) => ({
      name: officer.name,
      badge: officer.badge,
      department: officer.department,
    })),
    outcome: data.outcome,
    charges: data.charges,
    incidentDate: data.incidentDate,
    relationship: data.relationship,
  };
}

/**
 * Every verified reportNew submission in the bucket, parsed to the field contract
 * and ordered by receipt. `submissionsDir` is the bucket's `submissions/` folder
 * (date subfolders + `verify/` + `status/`). Unverified reports are skipped; a
 * malformed envelope fails loud.
 */
export async function readVerifiedReportSubmissions(
  submissionsDir: string,
): Promise<ReportSubmission[]> {
  const verified = await verifiedReportIds(submissionsDir);
  const entries = await readdir(submissionsDir, { withFileTypes: true });
  const dateDirs = entries.filter(
    (entry) =>
      entry.isDirectory() && entry.name !== "verify" && entry.name !== "status",
  );
  const reports: ReportSubmission[] = [];
  for (const dir of dateDirs) {
    const reportDir = path.join(submissionsDir, dir.name, REPORT_FORM);
    const files = await readdir(reportDir).catch(() => [] as string[]);
    for (const file of files.filter((name) => name.endsWith(".json"))) {
      const report = toReportSubmission(
        await readJson(path.join(reportDir, file)),
      );
      if (verified.has(report.submissionId)) {
        reports.push(report);
      }
    }
  }
  return reports.sort((left, right) =>
    left.receivedAt.localeCompare(right.receivedAt),
  );
}
