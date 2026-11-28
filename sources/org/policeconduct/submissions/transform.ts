import { open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  EmittedRecords,
  ResolvedAgencyLocation,
  TransformDataContext,
  SourceManifest,
  SourceTransform,
} from "../../../../src/cli/transform/source-transform.js";
import type { InputAccounting } from "../../../../src/cli/transform/accounting.js";
import type { Finding } from "../../../../src/shared/data-annotations.js";
import {
  REPORT_FORM,
  readSubmissions,
  type ReportSubmission,
  type StatusRecord,
  type Submissions,
  type VerifyRecord,
} from "./submissions.js";

const SOURCE = "org/policeconduct/submissions";

// Standalone (ADR 0030/0031): reads the S3-synced bucket (acquire) plus the fully
// imported roster to resolve officers, so it runs on its own after the group
// reconstruction, not inside it.

// A submission publishes only with a status verdict a human set to one of these;
// a rejected one is permanently excluded; anything else is held for review.
// Findings, log lines, errors and the review report's reason never hold
// submitter text.
const APPROVED = new Set(["approved", "published"]);
const REJECTED = new Set(["rejected"]);

async function writeReviewReport(
  state: string,
  heldOrRejected: { submissionId: string; title: string; reason: string }[],
): Promise<void> {
  const reportPath = path.join(state, "review-report.json");
  const temporaryPath = path.join(state, `.review-report-${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify({ heldOrRejected }, null, 2), "utf8");
  } catch (error) {
    await handle.close();
    await rm(temporaryPath, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await rename(temporaryPath, reportPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

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
  const state = location.match(
    /\b([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?\s*$/,
  )?.[1];
  const city = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  return { address: location, city, state, zip_code: zip };
}

function input(name: string): InputAccounting {
  return { input: name, read: 0, emitted: 0, reported: 0, notSelected: {} };
}

function notSelected(inputs: InputAccounting[], reason: string): void {
  for (const accounting of inputs) {
    accounting.notSelected[reason] = (accounting.notSelected[reason] ?? 0) + 1;
  }
}

// The verify record and the human-set status record (ADR 0030) of each
// reportNew submission. A status record names its submission directly or by
// verificationId through the verify record. The records of other forms are
// counted here; a record that fits no submission fails.
function matchRecords(
  {
    reports,
    verifyRecords,
    statusRecords,
    otherFormSubmissionIds,
  }: Submissions,
  verifyAccounting: InputAccounting,
  statusAccounting: InputAccounting,
): {
  verifyBySubmission: Map<string, VerifyRecord>;
  statusBySubmission: Map<string, StatusRecord>;
} {
  const reportIds = new Set(reports.map((report) => report.submissionId));
  const verifyBySubmission = new Map<string, VerifyRecord>();
  const verifyByVerification = new Map<string, VerifyRecord>();
  for (const record of verifyRecords) {
    verifyAccounting.read += 1;
    const sameVerification = verifyByVerification.get(record.verificationId);
    if (sameVerification !== undefined) {
      throw new Error(
        `${SOURCE}: verify records ${sameVerification.file} and ${record.file} hold one verificationId.`,
      );
    }
    verifyByVerification.set(record.verificationId, record);
    const earlier = verifyBySubmission.get(record.submissionId);
    if (earlier !== undefined) {
      throw new Error(
        `${SOURCE}: verify records ${earlier.file} and ${record.file} are for one submission.`,
      );
    }
    verifyBySubmission.set(record.submissionId, record);
    if (reportIds.has(record.submissionId)) {
      if (record.formName !== REPORT_FORM) {
        throw new Error(
          `${SOURCE}: verify record ${record.file} is not for the ${REPORT_FORM} form, but its submission is in a ${REPORT_FORM} folder.`,
        );
      }
    } else if (record.formName === REPORT_FORM) {
      throw new Error(
        `${SOURCE}: verify record ${record.file} is for a ${REPORT_FORM} submission that is in no ${REPORT_FORM} folder.`,
      );
    } else {
      notSelected([verifyAccounting], "other form");
    }
  }

  const statusBySubmission = new Map<string, StatusRecord>();
  for (const record of statusRecords) {
    statusAccounting.read += 1;
    let submissionId: string;
    if ("submissionId" in record) {
      submissionId = record.submissionId;
    } else {
      const verify = verifyByVerification.get(record.verificationId);
      if (verify === undefined) {
        throw new Error(
          `${SOURCE}: status record ${record.file} names a verification that has no verify record.`,
        );
      }
      submissionId = verify.submissionId;
    }
    const earlier = statusBySubmission.get(submissionId);
    if (earlier !== undefined) {
      throw new Error(
        `${SOURCE}: status records ${earlier.file} and ${record.file} are for one submission.`,
      );
    }
    statusBySubmission.set(submissionId, record);
    if (reportIds.has(submissionId)) {
      continue;
    }
    if (!otherFormSubmissionIds.has(submissionId)) {
      throw new Error(
        `${SOURCE}: status record ${record.file} matches no submission.`,
      );
    }
    notSelected([statusAccounting], "other form");
  }
  return { verifyBySubmission, statusBySubmission };
}

// The importer geocodes state + place + zipCode alongside the address; a location
// too vague to yield them ("Tarrant county jail") cannot be geocoded on its own.
function isGeocodable(hints: ReturnType<typeof locationHints>): boolean {
  return (
    hints.city !== undefined &&
    hints.city.trim() !== "" &&
    hints.state !== undefined &&
    hints.state.trim() !== "" &&
    hints.zip_code !== undefined &&
    hints.zip_code.trim() !== ""
  );
}

type OfficerResolution = {
  ids: string[];
  agencyLocation: ResolvedAgencyLocation | undefined;
  defects: Finding[];
};

function finding(
  report: ReportSubmission,
  entry: Pick<Finding, "code" | "field" | "message">,
  evidence: Record<string, number>,
): Finding {
  return {
    ...entry,
    type: "warning",
    value: null,
    evidence: [{ file: `submissions/${report.file}`, ...evidence }],
    source_namespace: SOURCE,
    source_record_id: report.submissionId,
  };
}

// The distinct officer@agency ids the named officers resolve to, the location
// of the first resolved officer's agency that has one — the geocode fallback
// for a too-vague incident location (ADR 0030) — and one finding for each
// officer left off.
async function resolveOfficers(
  report: ReportSubmission,
  data: TransformDataContext,
  resolveAgency: NonNullable<TransformDataContext["resolveAgency"]>,
): Promise<OfficerResolution> {
  const resolved = new Set<string>();
  const defects: Finding[] = [];
  let agencyLocation: ResolvedAgencyLocation | undefined;
  for (const [index, officer] of report.officers.entries()) {
    const leftOff = (code: string, reason: string): void => {
      defects.push(
        finding(
          report,
          {
            code,
            field: `officers[${index}]`,
            message: `An officer named in this report is not linked to it, because ${reason}.`,
          },
          { officer: index + 1 },
        ),
      );
    };
    if (officer.name.trim() === "" || officer.department.trim() === "") {
      leftOff(
        "officer-name-or-agency-blank",
        "the report gives no name or no agency for that officer",
      );
      continue;
    }
    const agency = await resolveAgency({ agencyName: officer.department });
    if (agency === null) {
      leftOff(
        "officer-agency-not-found",
        "the agency the report gives for that officer is not one this site lists",
      );
      continue;
    }
    const personnel = await data.resolvePersonnel({
      agencyId: agency.agencyId,
      personnelName: officer.name,
    });
    if (personnel === null) {
      leftOff(
        "officer-not-on-agency-roster",
        "no officer with that name is on the roster of the agency the report gives",
      );
      continue;
    }
    resolved.add(personnel.agencyPersonnelId);
    if (agencyLocation === undefined) {
      agencyLocation = agency.location;
    }
  }
  return { ids: [...resolved], agencyLocation, defects };
}

export const transform: SourceTransform = async ({
  env,
  state,
  data,
  logger,
}): Promise<SourceManifest> => {
  const bucketDir = env?.SUBMISSIONS_BUCKET_DIR;
  if (bucketDir === undefined || bucketDir.trim() === "") {
    throw new Error(
      `${SOURCE}: SUBMISSIONS_BUCKET_DIR is required (run acquire first).`,
    );
  }
  const resolveAgency = data?.resolveAgency?.bind(data);
  if (data === undefined || resolveAgency === undefined) {
    throw new Error(
      `${SOURCE}: run data context (resolveAgency/resolvePersonnel) is required.`,
    );
  }
  const submissions = await readSubmissions(
    path.join(bucketDir, "submissions"),
  );
  const reportAccounting = input(`${REPORT_FORM} submissions`);
  const verifyAccounting = input("verify records");
  const statusAccounting = input("status records");
  const { verifyBySubmission, statusBySubmission } = matchRecords(
    submissions,
    verifyAccounting,
    statusAccounting,
  );

  const reviews: EmittedRecords = {};
  const reviewPersonnel: EmittedRecords = {};
  const held: { submissionId: string; title: string; reason: string }[] = [];

  for (const report of submissions.reports) {
    reportAccounting.read += 1;
    const verify = verifyBySubmission.get(report.submissionId);
    const status = statusBySubmission.get(report.submissionId);
    // The verify and status records of a submission share its outcome.
    const inputs = [
      reportAccounting,
      ...(verify === undefined ? [] : [verifyAccounting]),
      ...(status === undefined ? [] : [statusAccounting]),
    ];
    const hold = (reason: string): void => {
      held.push({
        submissionId: report.submissionId,
        title: report.title,
        reason,
      });
      notSelected(inputs, `held: ${reason}`);
    };

    if (verify === undefined || !verify.verified) {
      notSelected(inputs, "not verified");
      continue;
    }
    if (status !== undefined && REJECTED.has(status.status)) {
      notSelected(inputs, "rejected");
      continue;
    }
    if (status === undefined || !APPROVED.has(status.status)) {
      hold(status === undefined ? "no verdict" : status.status);
      continue;
    }

    const {
      ids: officerIds,
      agencyLocation,
      defects,
    } = await resolveOfficers(report, data, resolveAgency);
    // Everything resolves to an officer: an approved report with no matched officer
    // is held, not published.
    if (officerIds.length === 0) {
      hold("approved but no officer resolved");
      continue;
    }

    // Prefer the submitter's own incident address when it geocodes; otherwise fall
    // back to the resolved officer's agency address so the report still anchors to
    // a point (ADR 0030). Only if neither can geocode is the report held.
    const submissionHints = locationHints(report.location);
    let location: ReturnType<typeof locationHints>;
    if (isGeocodable(submissionHints)) {
      location = submissionHints;
    } else if (agencyLocation !== undefined) {
      location = {
        address: agencyLocation.address,
        city: agencyLocation.city,
        state: agencyLocation.state,
        zip_code: agencyLocation.zipCode,
      };
      defects.push(
        finding(
          report,
          {
            code: "location-replaced-by-agency-address",
            field: "address",
            message:
              "The location given in this report could not be placed on a map, so the report is shown at the address of the officer's agency.",
          },
          {},
        ),
      );
    } else {
      hold("approved but location not geocodable");
      continue;
    }

    // Emit the Review and its officer links together, so a held report never
    // leaves an orphaned ReviewPersonnel behind.
    reviews[report.submissionId] = {
      metadata: { defects },
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
        ...location,
      },
    };
    for (const agencyPersonnelId of officerIds) {
      reviewPersonnel[`${report.submissionId}|${agencyPersonnelId}`] = {
        spec: {
          review_id: report.submissionId,
          agency_personnel_id: agencyPersonnelId,
        },
      };
    }
    for (const accounting of inputs) {
      accounting.emitted += 1;
    }
  }

  await writeReviewReport(state, held);
  logger?.info(
    `${SOURCE}: ${Object.keys(reviews).length} published, ${held.length} held.`,
  );

  return {
    artifacts: [
      { kind: "Reviews", records: reviews },
      { kind: "ReviewPersonnel", records: reviewPersonnel },
    ],
    accounting: [reportAccounting, verifyAccounting, statusAccounting],
  };
};
