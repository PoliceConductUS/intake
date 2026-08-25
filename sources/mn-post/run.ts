import { readFile } from "node:fs/promises";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";

export const produces: readonly ImportArtifactKind[] = [
  "LicensingAuthorities",
  "Agencies",
  "Personnel",
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
import { assertRequiredColumns } from "../../src/cli/run/assert-required-columns.js";
import type {
  SourceRun,
  EmittedRecords,
} from "../../src/cli/run/source-run.js";

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
 *   - `*.detail.json`    — one per-officer detail (the raw officer JSON), whose
 *                          `disciplinaryActions` drives the discipline records.
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

// Columns the roster CSV is read for (see the address/contact reads below),
// asserted present so a renamed column fails loud instead of silently dropping
// every agency's address and contact.
const AGENCY_CSV_COLUMNS = [
  "Agency",
  "State",
  "City",
  "Address",
  "Zip",
  "Chief Law Enforcement Officer",
  "Organization Email",
] as const;

export const run: SourceRun = async ({ paths }) => {
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
      assertRequiredColumns(Object.keys(csvRows[0]), AGENCY_CSV_COLUMNS, csvPath);
    }
    for (const row of csvRows) {
      const name = (row["Agency"] ?? "").trim();
      if (name !== "") {
        csvByName.set(name, row);
      }
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
  const licenses: EmittedRecords = {};
  const agencyPersonnel: EmittedRecords = {};
  // Officer (contactId) → the agency ids they hold an emitted assignment at. A
  // disciplinary action attributes to every one of them (an officer active at
  // several agencies implicates all of them).
  const assignmentAgenciesByContact = new Map<string, Set<string>>();

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
      // resolved at import from a property-cache seed and required non-empty by
      // the AgencyCreate mutation; null would instead mean "set this column to
      // null", which a required location field must never be.
      const location: Record<string, string> = {
        // Every MN POST agency is in Minnesota; the Q2 sheet confirms it.
        state: nullIfBlank(csv?.["State"]) ?? "MN",
      };
      const city = nullIfBlank(csv?.["City"]);
      const address = nullIfBlank(csv?.["Address"]);
      const zipCode = nullIfBlank(csv?.["Zip"]);
      if (city !== null) location.city = city;
      if (address !== null) location.address = address;
      if (zipCode !== null) location.zip_code = zipCode;
      agencies[agency.id] = {
        spec: {
          name: agency.name,
          ...location,
          contact_name: nullIfBlank(csv?.["Chief Law Enforcement Officer"]),
          contact_email: nullIfBlank(csv?.["Organization Email"]),
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

      // One License per distinct licenseId, issued by MN POST.
      if (licenseId !== null && licenseType !== null) {
        licenses[licenseId] = {
          spec: {
            personnel_id: contactId,
            license_type: licenseType,
            status: nullIfBlank(asString(row.status)),
            first_awarded: startDate,
            issued_by_authority_id: "mn-post",
          },
        };
      }

      // Assignment at this roster's agency. title = licenseType (the closest role
      // MN provides); start_date = the license issue date (no assignment dates in
      // the snapshot). Keyed by (officer, agency) — one current assignment each.
      if (startDate !== null && licenseType !== null) {
        agencyPersonnel[`${contactId}|${agency.id}`] = {
          spec: {
            agency_id: agency.id,
            personnel_id: contactId,
            start_date: startDate,
            end_date: null,
            title: licenseType,
            license_id:
              licenseId !== null && licenses[licenseId] !== undefined
                ? licenseId
                : null,
          },
        };
        const held =
          assignmentAgenciesByContact.get(contactId) ?? new Set<string>();
        held.add(agency.id);
        assignmentAgenciesByContact.set(contactId, held);
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

  for (const jsonPath of paths.filter((p) =>
    p.toLowerCase().endsWith(".detail.json"),
  )) {
    let detail: unknown;
    try {
      detail = JSON.parse(await readFile(jsonPath, "utf8"));
    } catch {
      continue;
    }
    const actions = (detail as { disciplinaryActions?: unknown })
      .disciplinaryActions;
    if (!Array.isArray(actions)) {
      continue;
    }
    for (const rawAction of actions) {
      const action = (rawAction ?? {}) as Record<string, unknown>;
      const contactId = nullIfBlank(asString(action.contactId));
      const caseNumber = nullIfBlank(asString(action.caseNumber));
      // A disciplinary record needs its POST case id and an officer to attribute
      // it to. An officer with no known assignment (best-effort attribution
      // isn't possible) is a future manual-resolution case; skip for now.
      if (contactId === null || caseNumber === null) {
        continue;
      }
      const heldAgencies = assignmentAgenciesByContact.get(contactId);
      if (heldAgencies === undefined || heldAgencies.size === 0) {
        continue;
      }
      const documentName = nullIfBlank(asString(action.documentName));
      const documentUrl = nullIfBlank(asString(action.documentURL));
      const effectiveDate = toDate(asString(action.effectiveDate));
      // Key per officer+case: MN's `caseNumber` is heterogeneous (a PB-style id
      // for some, a descriptive string for others), so officer-scoping keeps
      // each officer's disciplinary record distinct and collision-free.
      const disciplineKey = `${contactId}|${caseNumber}`;

      discipline[disciplineKey] = {
        spec: {
          action: documentName ?? "POST Disciplinary Action",
          effective_date: effectiveDate,
          expiration_date: toDate(asString(action.expirationDate)),
          case_number: caseNumber,
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
            published_at: effectiveDate,
          },
        };
      }
      // Attribute the event (and its document) to every assignment the officer
      // held — all implicated agencies, per the multi-agency rule.
      for (const agencyId of heldAgencies) {
        const assignmentKey = `${contactId}|${agencyId}`;
        disciplineAgencyPersonnel[`${disciplineKey}|${agencyId}`] = {
          spec: {
            discipline_id: disciplineKey,
            agency_personnel_id: assignmentKey,
          },
        };
        if (documentUrl !== null) {
          coverageLinkAgencyPersonnel[`${disciplineKey}|${agencyId}`] = {
            spec: {
              coverage_link_id: disciplineKey,
              agency_personnel_id: assignmentKey,
              confidence: "documented",
            },
          };
        }
      }
    }
  }

  return {
    artifacts: [
      { kind: "LicensingAuthorities", records: licensingAuthorities },
      { kind: "Agencies", records: agencies },
      { kind: "Personnel", records: personnel },
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
