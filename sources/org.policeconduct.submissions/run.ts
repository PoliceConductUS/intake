import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";
import type {
  EmittedRecords,
  RunDataContext,
  SourceManifest,
  SourceRun,
} from "../../src/cli/run/source-run.js";
import {
  readVerifiedReportSubmissions,
  type ReportSubmission,
} from "./submissions.js";

export const produces: readonly ImportArtifactKind[] = [
  "Reviews",
  "ReviewPersonnel",
];

// Standalone (ADR 0030/0031): reads the S3-synced bucket (acquire) plus the fully
// imported roster to resolve officers, so it runs on its own after the group
// reconstruction, not inside it.
export const standalone = true;

// A submission publishes only with a status verdict a human set to one of these;
// a rejected one is permanently excluded; anything else is held for review.
const APPROVED = new Set(["approved", "published"]);
const REJECTED = new Set(["rejected"]);

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Best-effort geocode hints from a free-text location (e.g.
// "5910 N MacArthur Blvd, Irving, TX 75039" → city Irving, state TX, zip 75039).
function locationHints(location: string): {
  address: string;
  city?: string;
  state?: string;
  zip_code?: string;
} {
  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const zip = location.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];
  const state = location.match(/\b([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?\s*$/)?.[1];
  const city = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  return { address: location, city, state, zip_code: zip };
}

// The human-set verdict per submission (ADR 0030), read from submissions/status/.
// Records key by submissionId directly or by verificationId → the verify record's
// submissionId.
async function readStatusVerdicts(
  submissionsDir: string,
): Promise<Map<string, string>> {
  const byVerificationId = new Map<string, string>();
  const verifyDir = path.join(submissionsDir, "verify");
  for (const file of (await readdir(verifyDir).catch(() => [])).filter((name) =>
    name.endsWith(".json"),
  )) {
    const record = JSON.parse(
      await readFile(path.join(verifyDir, file), "utf8"),
    ) as { submissionId?: string; verificationId?: string };
    if (record.verificationId !== undefined && record.submissionId !== undefined) {
      byVerificationId.set(record.verificationId, record.submissionId);
    }
  }

  const verdicts = new Map<string, string>();
  const statusDir = path.join(submissionsDir, "status");
  for (const file of (await readdir(statusDir).catch(() => [])).filter((name) =>
    name.endsWith(".json"),
  )) {
    const record = JSON.parse(
      await readFile(path.join(statusDir, file), "utf8"),
    ) as { submissionId?: string; verificationId?: string; status?: string };
    if (record.status === undefined) {
      continue;
    }
    const submissionId =
      record.submissionId ??
      (record.verificationId !== undefined
        ? byVerificationId.get(record.verificationId)
        : undefined);
    if (submissionId !== undefined) {
      verdicts.set(submissionId, record.status);
    }
  }
  return verdicts;
}

// Emit ReviewPersonnel for each named officer resolved to an officer@agency
// (resolve-or-fail against the roster). Returns the resolved count.
async function resolveOfficers(
  report: ReportSubmission,
  data: RunDataContext,
  reviewPersonnel: EmittedRecords,
): Promise<number> {
  let resolved = 0;
  for (const officer of report.officers) {
    if (officer.name.trim() === "" || officer.department.trim() === "") {
      continue;
    }
    const agency = await data.resolveAgency?.({ agencyName: officer.department });
    if (agency === undefined || agency === null) {
      continue;
    }
    const personnel = await data.resolvePersonnel({
      agencyId: agency.agencyId,
      personnelName: officer.name,
    });
    if (personnel === null) {
      continue;
    }
    const key = `${report.submissionId}|${personnel.agencyPersonnelId}`;
    reviewPersonnel[key] = {
      spec: {
        review_id: report.submissionId,
        agency_personnel_id: personnel.agencyPersonnelId,
      },
    };
    resolved += 1;
  }
  return resolved;
}

export const run: SourceRun = async ({
  env,
  state,
  data,
  logger,
}): Promise<SourceManifest> => {
  const bucketDir = env?.SUBMISSIONS_BUCKET_DIR;
  if (bucketDir === undefined || bucketDir.trim() === "") {
    throw new Error(
      "org.policeconduct.submissions: SUBMISSIONS_BUCKET_DIR is required (run acquire first).",
    );
  }
  if (data === undefined) {
    throw new Error(
      "org.policeconduct.submissions: run data context (resolveAgency/resolvePersonnel) is required.",
    );
  }
  const submissionsDir = path.join(bucketDir, "submissions");
  const reports = await readVerifiedReportSubmissions(submissionsDir);
  const verdicts = await readStatusVerdicts(submissionsDir);

  const reviews: EmittedRecords = {};
  const reviewPersonnel: EmittedRecords = {};
  const held: { submissionId: string; title: string; reason: string }[] = [];

  for (const report of reports) {
    const verdict = verdicts.get(report.submissionId) ?? "";
    if (REJECTED.has(verdict)) {
      continue;
    }
    if (!APPROVED.has(verdict)) {
      held.push({
        submissionId: report.submissionId,
        title: report.title,
        reason: verdict === "" ? "no verdict" : verdict,
      });
      continue;
    }

    const officerCount = await resolveOfficers(report, data, reviewPersonnel);
    // Everything resolves to an officer: an approved report with no matched officer
    // is held, not published.
    if (officerCount === 0) {
      held.push({
        submissionId: report.submissionId,
        title: report.title,
        reason: "approved but no officer resolved",
      });
      continue;
    }

    reviews[report.submissionId] = {
      spec: {
        id: report.submissionId,
        slug: slugify(`${report.title}-${report.submissionId}`),
        title: report.title,
        description: report.description,
        incident_date: report.incidentDate === "" ? null : report.incidentDate,
        desired_outcome: report.outcome === "" ? null : report.outcome,
        charges: report.charges === "" ? null : report.charges,
        submitter_relationship:
          report.relationship === "" ? null : report.relationship,
        ...locationHints(report.location),
      },
    };
  }

  await writeFile(
    path.join(state, "review-report.json"),
    JSON.stringify({ heldOrRejected: held }, null, 2),
    "utf8",
  );
  logger?.info(
    `org.policeconduct.submissions: ${Object.keys(reviews).length} published, ${held.length} held.`,
  );

  return {
    artifacts: [
      { kind: "Reviews", records: reviews },
      { kind: "ReviewPersonnel", records: reviewPersonnel },
    ],
  };
};
