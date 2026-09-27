import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";

export const produces: readonly ImportArtifactKind[] = [
  "LicensingAuthorities",
  "AuthorityLicenses",
  "Agencies",
  "Personnel",
  "PersonnelEducations",
  "Licenses",
  "AgencyPersonnel",
  "Disciplines",
  "DisciplineAgencyPersonnel",
  "CoverageLinks",
  "CoverageLinkAgencyPersonnel",
];
import path from "node:path";
import { parse as parseCsvSync } from "csv-parse/sync";
import { parse as parseYaml } from "yaml";
import { assertRequiredColumns } from "../../src/cli/transform/assert-required-columns.js";
import { canonicalLicenseType } from "../../src/shared/license.js";
import type {
  SourceTransform,
  EmittedRecords,
} from "../../src/cli/transform/source-transform.js";
import type { OrderAnalysis } from "./acquire/collect-documents.js";

/**
 * MN POST — reconstructs the Minnesota rows from the scraped POST License Search
 * data. The `acquire` phase downloads these raw inputs (preserving the site's
 * own format — csv stays csv, json stays json) under
 * `$INTAKE_WORKSPACE/mn-post/source/`:
 *
 *   - `agency-ids.yaml`  — agency name → Salesforce `a2j…` id (the durable
 *                          identity ledger; every emitted agency is keyed by this id).
 *   - `agencies.csv`     — the active-agency list (name, address, city, state,
 *                          zip, chief, email); joined to agencies by name.
 *   - `*.roster.json`    — one per-agency roster (the raw officer list from the
 *                          site). The filename slug identifies the agency; each
 *                          row carries `contactId` (person), `licenseId`
 *                          (license), `name` ("Last, First Middle"),
 *                          `licenseType`, `status`, and `originalLicenseIssueDate`.
 *   - `*.detail.json`    — per-officer detail: `activeEmployment[].rosterId`
 *                          identifies assignments; `licenses.POSTLicenseList`
 *                          identifies their contact, and `disciplinaryActions`
 *                          drives the discipline records.
 *   - `*.document.json`  — one per disciplinary order document (the PDF the
 *                          action links to): its extracted text and the
 *                          analysis of what it says (allegation, violation,
 *                          finding, chief's action, sanction), keyed by URL.
 *
 * Entities (TCOLE-shaped): a single `LicensingAuthorities` (MN POST), `Agencies`
 * (keyed by the a2j id), `Personnel` (keyed by `contactId`), `Licenses` (keyed by
 * `licenseId`), and `AgencyPersonnel` (an officer's assignment at the roster's
 * agency). Cross-references carry source keys the import resolves to canonical
 * ids. `title` holds the `licenseType` (the closest role MN provides);
 * `start_date` is `originalLicenseIssueDate` (the roster is a current snapshot
 * with no assignment dates). Deterministic: no network, clock, or randomness.
 */
export const description =
  "Minnesota POST — agencies, officers, licenses, and disciplinary/coverage records from the MN POST license-lookup rosters.";

// The roster CSV columns this source reads, each header string defined exactly
// once. Object.values(AGENCY_CSV) is the required-columns list asserted at read
// (a renamed header fails loud instead of silently dropping address/contact);
// every read goes through AGENCY_CSV.<key>, so a rename is a one-line change.
const AGENCY_CSV = {
  agency: "Agency",
  state: "State",
  city: "City",
  address: "Address",
  zip: "Zip",
  chief: "Chief Law Enforcement Officer",
  email: "Organization Email",
} as const;

type OfficerDetail = {
  licenses?: { POSTLicenseList?: Array<{ contactId?: string }> };
  activeEmployment?: Array<{ rosterId?: string; agencyName?: string }>;
  disciplinaryActions?: unknown;
  education?: unknown;
};

export const transform: SourceTransform = async ({ paths, logger }) => {
  const rosterPaths = paths.filter((p) => p.endsWith(".roster.json")).sort();
  const idMapPath = paths.find((p) => path.basename(p) === "agency-ids.yaml");
  const csvPath = paths.find((p) => p.toLowerCase().endsWith(".csv"));
  if (idMapPath === undefined) {
    throw new Error(
      "mn-post expects an agency-ids.yaml (agency name → a2j id).",
    );
  }

  const idMap = parseYaml(await readFile(idMapPath, "utf8")) as Record<
    string,
    { id?: string }
  >;
  const agencyBySlug = new Map<string, { name: string; id: string }>();
  for (const [name, entry] of Object.entries(idMap)) {
    const id = entry?.id;
    if (typeof id === "string" && id.trim() !== "") {
      agencyBySlug.set(slugify(name), { name, id });
    }
  }

  const csvByName = new Map<string, Record<string, string>>();
  if (csvPath !== undefined) {
    const csvRows = parseCsv(await readFile(csvPath, "utf8"));
    if (csvRows[0] !== undefined) {
      // Fail loud if the roster CSV is missing a column this source reads,
      // rather than silently emitting agencies with no address/contact.
      assertRequiredColumns(
        Object.keys(csvRows[0]),
        Object.values(AGENCY_CSV),
        csvPath,
      );
    }
    for (const row of csvRows) {
      const name = (row[AGENCY_CSV.agency] ?? "").trim();
      if (name !== "") {
        csvByName.set(name, row);
      }
    }
  }

  const details: OfficerDetail[] = [];
  const assignmentsByContact = new Map<string, Map<string, Set<string>>>();
  for (const file of paths.filter((p) =>
    p.toLowerCase().endsWith(".detail.json"),
  )) {
    const detail = JSON.parse(await readFile(file, "utf8")) as OfficerDetail;
    details.push(detail);
    for (const license of detail.licenses?.POSTLicenseList ?? []) {
      const contactId = nullIfBlank(license.contactId);
      if (contactId === null) continue;
      const agencies =
        assignmentsByContact.get(contactId) ?? new Map<string, Set<string>>();
      for (const employment of detail.activeEmployment ?? []) {
        const rosterId = nullIfBlank(employment.rosterId);
        const name = nullIfBlank(employment.agencyName);
        if (rosterId === null || name === null) continue;
        const key = slugify(name);
        const assignments = agencies.get(key) ?? new Set<string>();
        assignments.add(rosterId);
        agencies.set(key, assignments);
      }
      assignmentsByContact.set(contactId, agencies);
    }
  }

  const licensingAuthorities: EmittedRecords = {
    "mn-post": {
      spec: {
        name: "Minnesota Board of Peace Officer Standards and Training",
        abbreviation: "MN POST",
        website: "https://dps.mn.gov/entity/post",
        location_path_id: "mn",
      },
    },
  };
  const agencies: EmittedRecords = {};
  const personnel: EmittedRecords = {};
  const authorityLicenses: EmittedRecords = {};
  const licenses: EmittedRecords = {};
  const agencyPersonnel: EmittedRecords = {};

  for (const rosterPath of rosterPaths) {
    const fileSlug = path
      .basename(rosterPath, ".roster.json")
      .replace(/-[0-9a-f]{12}$/, "");
    const parsed = JSON.parse(await readFile(rosterPath, "utf8"));
    const roster: unknown[] = Array.isArray(parsed) ? parsed : [];
    const agency = agencyBySlug.get(fileSlug);
    if (agency === undefined) {
      // An allow-empty agency has no officers and no id, so it is absent from
      // agency-ids.yaml and produces nothing. An unmapped roster with officers
      // is a real error.
      if (roster.length === 0) {
        continue;
      }
      throw new Error(
        `mn-post roster ${path.basename(rosterPath)} has no agency in agency-ids.yaml (slug ${fileSlug}).`,
      );
    }

    if (agencies[agency.id] === undefined) {
      const csv = csvByName.get(agency.name);
      // address/city/zip are OMITTED (undefined) when the Q2 sheet lacks them —
      // never null. An omitted field is the temporarily-absent partial state,
      // resolved at import from a CLI-managed cache value and required non-empty by
      // the AgencyCreate mutation; null would instead mean "set this column to
      // null", which a required location field must never be.
      const location: Record<string, string> = {
        // Every MN POST agency is in Minnesota; the Q2 sheet confirms it.
        state: nullIfBlank(csv?.[AGENCY_CSV.state]) ?? "MN",
      };
      const city = nullIfBlank(csv?.[AGENCY_CSV.city]);
      const address = nullIfBlank(csv?.[AGENCY_CSV.address]);
      const zipCode = nullIfBlank(csv?.[AGENCY_CSV.zip]);
      if (city !== null) location.city = city;
      if (address !== null) location.address = address;
      if (zipCode !== null) {
        location.zip_code = zipCode.replace(/^(\d{5})(\d{4})$/, "$1-$2");
      }
      agencies[agency.id] = {
        spec: {
          name: agency.name,
          ...location,
          contact_name: nullIfBlank(csv?.[AGENCY_CSV.chief]),
          contact_email: nullIfBlank(csv?.[AGENCY_CSV.email]),
        },
      };
    }

    for (const rawRow of roster) {
      const row = (rawRow ?? {}) as Record<string, unknown>;
      // Every officer on the roster is imported, disciplined or not — an
      // officer's discipline history is exactly what this database exists to
      // record, so it is never a reason to drop them. (The per-officer detail
      // JSONs carry the `disciplinaryActions` themselves; importing those as
      // LicenseActions is a separate, additive step.)
      const contactId = nullIfBlank(asString(row.contactId));
      // A person needs a stable id and a first name; skip rows without them.
      if (contactId === null) {
        continue;
      }
      const name = parseOfficerName(asString(row.name));
      if (name.first === null) {
        continue;
      }
      const licenseId = nullIfBlank(asString(row.licenseId));
      const licenseType = nullIfBlank(asString(row.licenseType));
      const startDate = toDate(asString(row.originalLicenseIssueDate));

      personnel[contactId] = {
        spec: {
          id: contactId,
          first_name: name.first,
          last_name: name.last,
          middle_name: name.middle,
        },
      };

      // The officer's holding of an MN POST license type. Keyed and referenced by
      // (officer, canonical type); the type is its own AuthorityLicense.
      const licenseHoldingKey =
        licenseType === null
          ? null
          : `${contactId}|${canonicalLicenseType(licenseType)}`;
      if (licenseId !== null && licenseType !== null) {
        const authorityLicenseId = `mn-post|${canonicalLicenseType(licenseType)}`;
        authorityLicenses[authorityLicenseId] = {
          spec: {
            licensing_authority_id: "mn-post",
            name: canonicalLicenseType(licenseType),
          },
        };
        licenses[licenseHoldingKey!] = {
          spec: {
            personnel_id: contactId,
            authority_license_id: authorityLicenseId,
            status: nullIfBlank(asString(row.status)),
            first_awarded: startDate,
          },
        };
      }

      // Preserve POST's assignment identity; multiple jobs at one agency are distinct.
      // The existing role and license-issue-date interpretation is unchanged.
      if (startDate !== null && licenseType !== null) {
        const rosterIds = assignmentsByContact
          .get(contactId)
          ?.get(slugify(agency.name));
        if (rosterIds === undefined || rosterIds.size === 0) {
          throw new Error(
            `mn-post: no activeEmployment rosterId for contact ${contactId} at ${agency.name} (${agency.id}); check the acquired officer details.`,
          );
        }
        for (const rosterId of rosterIds) {
          agencyPersonnel[rosterId] = {
            spec: {
              agency_id: agency.id,
              personnel_id: contactId,
              start_date: startDate,
              end_date: null,
              title: licenseType,
              license_id:
                licenseHoldingKey !== null &&
                licenses[licenseHoldingKey] !== undefined
                  ? licenseHoldingKey
                  : null,
            },
          };
        }
      }
    }
  }

  // Discipline: each officer's detail JSON carries a `disciplinaryActions` list
  // (the string "No POST Disciplinary Actions found" when there are none). Every
  // action is a POST order — read them for all officers, since the roster's
  // boolean flag can drift from the authoritative list.
  const discipline: EmittedRecords = {};
  const disciplineAgencyPersonnel: EmittedRecords = {};
  const coverageLinks: EmittedRecords = {};
  const coverageLinkAgencyPersonnel: EmittedRecords = {};

  // What each order document says, by the URL the action links to. An action
  // whose document the site no longer serves (see acquire's skip report) has no
  // entry and leaves the order fields null.
  type OrderEvidence = { sha256: string; analysis: OrderAnalysis };
  const documentsByUrl = new Map<string, OrderEvidence[]>();
  const evidenceByCase = new Map<string, OrderEvidence>();
  for (const jsonPath of paths.filter((p) =>
    p.toLowerCase().endsWith(".document.json"),
  )) {
    const document = JSON.parse(await readFile(jsonPath, "utf8")) as {
      url: string;
      analysis: OrderAnalysis;
      sha256: string;
    };
    const evidence = { sha256: document.sha256, analysis: document.analysis };
    const documents = documentsByUrl.get(document.url) ?? [];
    documents.push(evidence);
    documentsByUrl.set(document.url, documents);
  }

  for (const detail of details) {
    const actions = detail.disciplinaryActions;
    if (!Array.isArray(actions)) {
      continue;
    }
    for (const rawAction of actions) {
      const action = (rawAction ?? {}) as Record<string, unknown>;
      const contactId = nullIfBlank(asString(action.contactId));
      const caseNumber = nullIfBlank(asString(action.caseNumber));
      if (contactId === null || caseNumber === null) {
        throw new Error(
          `mn-post discipline: missing contactId or caseNumber (${contactId}, ${caseNumber})`,
        );
      }
      if (personnel[contactId] === undefined) {
        throw new Error(
          `mn-post discipline ${caseNumber}: unknown person contactId ${contactId}`,
        );
      }
      const documentName = nullIfBlank(asString(action.documentName));
      const documentUrl = nullIfBlank(asString(action.documentURL));
      const effectiveDate = toDate(asString(action.effectiveDate));
      // Key per officer+case: MN's `caseNumber` is heterogeneous (a PB-style id
      // for some, a descriptive string for others), so officer-scoping keeps
      // each officer's disciplinary record distinct and collision-free.
      const disciplineKey = `${contactId}|${caseNumber}`;

      const documents =
        documentUrl === null ? [] : (documentsByUrl.get(documentUrl) ?? []);
      const order = documents.at(-1)?.analysis;
      const substantive = {
        action: documentName ?? "POST Disciplinary Action",
        effective_date: effectiveDate,
        expiration_date: toDate(asString(action.expirationDate)),
      };
      const previous = discipline[disciplineKey]?.spec as
        | typeof substantive
        | undefined;
      if (
        previous !== undefined &&
        !isDeepStrictEqual(substantive, {
          action: previous.action,
          effective_date: previous.effective_date,
          expiration_date: previous.expiration_date,
        })
      ) {
        throw new Error(
          `mn-post: conflicting discipline case ${disciplineKey}`,
        );
      }
      for (const evidence of documents) {
        const previousEvidence = evidenceByCase.get(disciplineKey);
        if (
          previousEvidence !== undefined &&
          !isDeepStrictEqual(previousEvidence, evidence)
        ) {
          throw new Error(
            `mn-post: conflicting document evidence for discipline case ${disciplineKey}`,
          );
        }
        evidenceByCase.set(disciplineKey, evidence);
      }
      discipline[disciplineKey] = {
        spec: {
          personnel_id: contactId,
          licensing_authority_id: "mn-post",
          document_url: documentUrl,
          action: documentName ?? "POST Disciplinary Action",
          effective_date: effectiveDate,
          expiration_date: toDate(asString(action.expirationDate)),
          case_number: caseNumber,
          allegation: order?.allegation ?? null,
          violation: order?.violation ?? null,
          finding: order?.finding ?? null,
          chief_action: order?.chief_action ?? null,
          sanction: order?.sanction ?? null,
        },
      };
      // The order document as a coverage link (when the order URL is present).
      if (documentUrl !== null) {
        coverageLinks[disciplineKey] = {
          spec: {
            url: documentUrl,
            normalized_url: normalizeUrl(documentUrl),
            title: [documentName, caseNumber].filter(Boolean).join(" "),
            source_name: "Minnesota POST",
            // published_at is nullable-non-empty: emit null, never "" (a blank
            // effective date), or the create/update spec rejects it.
            published_at: effectiveDate || null,
          },
        };
      }
    }
  }

  const education: EmittedRecords = {};
  const educationByCourse = new Map<string, unknown>();
  for (const detail of details) {
    if (!Array.isArray(detail.education)) continue;
    for (const rawCourse of detail.education) {
      const course = (rawCourse ?? {}) as Record<string, unknown>;
      const courseId = nullIfBlank(asString(course.courseId));
      const contactId = nullIfBlank(asString(course.contactId));
      if (courseId === null || contactId === null) {
        throw new Error(
          `mn-post education: missing courseId or contactId (${courseId}, ${contactId})`,
        );
      }
      if (personnel[contactId] === undefined) {
        throw new Error(
          `mn-post education ${courseId}: unknown person contactId ${contactId}`,
        );
      }
      const spec = {
        personnel_id: contactId,
        name: nullIfBlank(asString(course.name)),
        completion_date: toDate(asString(course.endDate)),
        credits: course.credits ?? null,
        sponsor_name: nullIfBlank(asString(course.sponsorname)),
        sponsor_instructor: nullIfBlank(asString(course.sponsorInstructor)),
      };
      const previous = educationByCourse.get(courseId);
      if (previous !== undefined && !isDeepStrictEqual(previous, spec)) {
        throw new Error(`mn-post: conflicting education course ${courseId}`);
      }
      educationByCourse.set(courseId, spec);
      if (spec.name === null) {
        const message = `mn-post: omitted education ${courseId}: missing or blank course name`;
        logger?.info(message);
        continue;
      }
      education[courseId] = { spec };
    }
  }

  return {
    artifacts: [
      { kind: "LicensingAuthorities", records: licensingAuthorities },
      { kind: "AuthorityLicenses", records: authorityLicenses },
      { kind: "Agencies", records: agencies },
      { kind: "Personnel", records: personnel },
      { kind: "PersonnelEducations", records: education },
      { kind: "Licenses", records: licenses },
      { kind: "AgencyPersonnel", records: agencyPersonnel },
      { kind: "Disciplines", records: discipline },
      { kind: "DisciplineAgencyPersonnel", records: disciplineAgencyPersonnel },
      { kind: "CoverageLinks", records: coverageLinks },
      {
        kind: "CoverageLinkAgencyPersonnel",
        records: coverageLinkAgencyPersonnel,
      },
    ],
  };
};

function asString(value: unknown): string | undefined {
  return typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : undefined;
}

function nullIfBlank(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}

/** Trims a scraped date to `YYYY-MM-DD`, or null when absent/malformed. */
function toDate(value: string | undefined): string | null {
  const match = (value ?? "").trim().match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

/** Normalize a document URL for dedup: lowercase scheme+host, drop fragment and trailing slash. */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

/** `Agency Name` → `agency-name` (matches the roster filename slugs). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Splits `"Last, First Middle"` into parts; the comma anchors the last name.
 * Falls back to first/last tokens when there is no comma.
 */
function parseOfficerName(name: string | undefined): {
  first: string | null;
  middle: string | null;
  last: string | null;
} {
  const text = (name ?? "").trim();
  if (text === "") {
    return { first: null, middle: null, last: null };
  }
  if (text.includes(",")) {
    const [last, rest = ""] = text.split(",", 2).map((part) => part.trim());
    const parts = rest.split(/\s+/).filter(Boolean);
    return {
      first: parts[0] ?? null,
      middle: parts.slice(1).join(" ") || null,
      last: nullIfBlank(last),
    };
  }
  const parts = text.split(/\s+/).filter(Boolean);
  return {
    first: parts[0] ?? null,
    middle: parts.length > 2 ? parts.slice(1, -1).join(" ") : null,
    last: parts.length > 1 ? (parts.at(-1) ?? null) : null,
  };
}

function parseCsv(text: string): Array<Record<string, string>> {
  return parseCsvSync(text, {
    bom: true,
    columns: (header: string[]) => header.map((column) => column.trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
}
