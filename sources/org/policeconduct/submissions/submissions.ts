import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// The bucket layout (ADR 0030): submissions/<date>/<formName>/<id>.json, plus
// submissions/verify/<verificationId>.json (email verification) and
// submissions/status/. A submission is VERIFIED when its verify record has a
// verifiedAt. v1 handles the reportNew form only.
export const REPORT_FORM = "reportNew";
const SOURCE = "org/policeconduct/submissions";

// One officer named in a report. The submission's `traits` (the retired rubric
// model) is deprecated and ignored — never read, never persisted.
export type OfficerRef = {
  name: string;
  badge: string;
  department: string;
};

// A parsed report submission — the source's field contract. Submitter PII
// (reporterName/Email/Phone, sourceIp, userAgent) is intentionally absent: it is
// never read into the record (ADR 0029 §3). `file` is relative to the
// submissions folder.
export type ReportSubmission = {
  file: string;
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

const VerifySchema = z.strictObject({
  verificationId: z.string().min(1),
  submissionId: z.string().min(1),
  formName: z.string().min(1),
  verifiedAt: z.string().min(1).nullable(),
  usedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  expiresAt: z.string().optional(),
  sentAt: z.string().optional(),
  email: z.string().optional(),
  secretHash: z.string().optional(),
  providerMessageId: z.string().optional(),
  resendCount: z.number().optional(),
});

const StatusSchema = z
  .strictObject({
    submissionId: z.string().min(1).optional(),
    verificationId: z.string().min(1).optional(),
    status: z.string().min(1),
    statusChangedAt: z.string().optional(),
    decision: z
      .strictObject({ at: z.string(), by: z.string(), reason: z.string() })
      .optional(),
  })
  .refine(
    (record) =>
      (record.submissionId === undefined) !==
      (record.verificationId === undefined),
    { message: "must hold exactly one of submissionId and verificationId" },
  );

export type VerifyRecord = {
  file: string;
  verificationId: string;
  submissionId: string;
  formName: string;
  verified: boolean;
};

export type StatusRecord = { file: string; status: string } & (
  { submissionId: string } | { verificationId: string }
);

export type Submissions = {
  reports: ReportSubmission[];
  verifyRecords: VerifyRecord[];
  statusRecords: StatusRecord[];
  otherFormSubmissionIds: ReadonlySet<string>;
};

// The engine's JSON error quotes the file content, which is submitter text.
async function readJson(filePath: string): Promise<unknown> {
  const contents = await readFile(filePath, "utf8");
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`${SOURCE}: ${filePath} is not valid JSON.`);
  }
}

function parse<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  filePath: string,
  what: string,
): z.output<Schema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `${SOURCE}: ${filePath} is not a valid ${what}: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

async function jsonFileNames(
  directory: string,
  missing: "none" | "fail",
): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (
      missing === "none" &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
  return names.filter((name) => name.endsWith(".json")).sort();
}

// Submissions are form-encoded: officers arrive as flat keys
// (`officers[0][name]`, `officers[0][badge]`, ...), not a nested array. Rebuild the
// nested `officers` the schema expects, indexed by N, so no named officer is lost.
function deflattenOfficers(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return data;
  }
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.officers)) {
    return record;
  }
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const [key, value] of Object.entries(record)) {
    const match = key.match(/^officers\[(\d+)\]\[([a-zA-Z]+)\]$/);
    if (match === null) {
      continue;
    }
    const index = Number(match[1]);
    const officer = byIndex.get(index) ?? {};
    officer[match[2]!] = value;
    byIndex.set(index, officer);
  }
  if (byIndex.size === 0) {
    return record;
  }
  const officers = [...byIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, officer]) => officer);
  return { ...record, officers };
}

async function readReportSubmission(
  submissionsDir: string,
  file: string,
): Promise<ReportSubmission> {
  const filePath = path.join(submissionsDir, file);
  const what = `${REPORT_FORM} submission`;
  const envelope = parse(
    EnvelopeSchema,
    await readJson(filePath),
    filePath,
    what,
  );
  if (envelope.payload.formName !== REPORT_FORM) {
    throw new Error(
      `${SOURCE}: ${filePath} is in a ${REPORT_FORM} folder but its payload.formName is not ${REPORT_FORM}.`,
    );
  }
  const data = parse(
    ReportDataSchema,
    deflattenOfficers(envelope.payload.data),
    filePath,
    what,
  );
  return {
    file,
    submissionId: envelope.submissionId,
    receivedAt: envelope.receivedAt,
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
 * Everything the transform reads from the bucket's `submissions/` folder: every
 * reportNew submission ordered by receipt, every `verify/` and `status/`
 * record, and the submission IDs of the other forms (from their file names;
 * those files are not opened). Only a missing `verify` or `status` folder
 * means no records; any other read error, and any malformed file, fails.
 */
export async function readSubmissions(
  submissionsDir: string,
): Promise<Submissions> {
  const verifyRecords: VerifyRecord[] = [];
  for (const name of await jsonFileNames(
    path.join(submissionsDir, "verify"),
    "none",
  )) {
    const file = `verify/${name}`;
    const filePath = path.join(submissionsDir, file);
    const record = parse(
      VerifySchema,
      await readJson(filePath),
      filePath,
      "verify record",
    );
    verifyRecords.push({
      file,
      verificationId: record.verificationId,
      submissionId: record.submissionId,
      formName: record.formName,
      verified: record.verifiedAt !== null,
    });
  }

  const statusRecords: StatusRecord[] = [];
  for (const name of await jsonFileNames(
    path.join(submissionsDir, "status"),
    "none",
  )) {
    const file = `status/${name}`;
    const filePath = path.join(submissionsDir, file);
    const record = parse(
      StatusSchema,
      await readJson(filePath),
      filePath,
      "status record",
    );
    if (record.submissionId !== undefined) {
      statusRecords.push({
        file,
        status: record.status,
        submissionId: record.submissionId,
      });
    } else if (record.verificationId !== undefined) {
      statusRecords.push({
        file,
        status: record.status,
        verificationId: record.verificationId,
      });
    }
  }

  const reports = new Map<string, ReportSubmission>();
  const otherFormSubmissionIds = new Set<string>();
  const dateDirs = (await readdir(submissionsDir, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== "verify" &&
        entry.name !== "status",
    )
    .map((entry) => entry.name)
    .sort();
  for (const date of dateDirs) {
    const dateDir = path.join(submissionsDir, date);
    for (const entry of await readdir(dateDir, { withFileTypes: true })) {
      if (entry.name === REPORT_FORM) {
        for (const name of await jsonFileNames(
          path.join(dateDir, REPORT_FORM),
          "fail",
        )) {
          const report = await readReportSubmission(
            submissionsDir,
            `${date}/${REPORT_FORM}/${name}`,
          );
          const earlier = reports.get(report.submissionId);
          if (earlier !== undefined) {
            throw new Error(
              `${SOURCE}: ${earlier.file} and ${report.file} hold one submissionId.`,
            );
          }
          reports.set(report.submissionId, report);
        }
      } else if (entry.isDirectory()) {
        for (const name of await jsonFileNames(
          path.join(dateDir, entry.name),
          "fail",
        )) {
          otherFormSubmissionIds.add(name.slice(0, -".json".length));
        }
      }
    }
  }

  return {
    reports: [...reports.values()].sort((left, right) =>
      left.receivedAt.localeCompare(right.receivedAt),
    ),
    verifyRecords,
    statusRecords,
    otherFormSubmissionIds,
  };
}
