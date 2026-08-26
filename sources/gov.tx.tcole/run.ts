import type {
  SourceRun,
  EmittedRecords,
} from "../../src/cli/run/source-run.js";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";

export const produces: readonly ImportArtifactKind[] = [
  "LicensingAuthorities",
  "Agencies",
  "Personnel",
  "Licenses",
  "LicenseActions",
  "AgencyPersonnel",
  "AgencyPhoneNumbers",
];

/**
 * TX POST (TCOLE) — reconstructs the Texas rows of the database from a single
 * TCOLE Public-Information-Act workbook
 * (`PublicInformationRequest_2025-02-10_1410.xlsx`). Three sheets map onto the
 * existing import kinds:
 *
 *   - `Officers`     → Personnel        (keyed by `PUBLIC_GUID`)
 *   - `Departments`  → Agency           (keyed by `DEPARTMENT_NUMBER`; the
 *                                        import pipeline geocodes the address
 *                                        into slug/location_path/lat/lng)
 *   - `Services`     → AgencyPersonnel   (keyed by the synthetic tuple
 *                                        `PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE`
 *                                        so it matches the prior TCOLE identity
 *                                        map's `id_field` and reuses seeded IDs)
 *
 * `title` carries the `APPOINTMENT` (the role — "Peace Officer", "Chief of
 * Police"), matching how the column is populated today (seed set
 * `agency_personnel.title = APPOINTMENT`). A blank APPOINTMENT is recorded as
 * "Unknown" rather than dropped. The separate license reference
 * (`agency_personnel.license_id`) links to the emitted License
 * (`PUBLIC_GUID|LICENSE`) when the assignment carries a non-blank LICENSE.
 *
 * The licensing model adds three more kinds — `LicensingAuthorities` (just
 * TCOLE, the one authority this source has data for; per ADR 0015 a source emits
 * only its own authorities, with no shared/curated dataset), `Licenses` (distinct
 * `PUBLIC_GUID`×`LICENSE`, keyed `PUBLIC_GUID|LICENSE`), and `LicenseActions`
 * (one per `OfficersLicensesActions` row, keyed
 * `PUBLIC_GUID|LICENSE|LICENSE_ACTION|ACTION_DATE`).
 *
 * Deterministic: no network, clock, or randomness. Cross-references
 * (`agency_id`, `personnel_id`) carry TCOLE source keys that the import
 * transform resolves to canonical IDs via the ledger; every referenced agency
 * and officer is emitted here so no reference is left unmapped.
 */
export const description =
  "Texas TCOLE — agencies, officers, licenses, and assignments reconstructed from the TCOLE public-information workbook.";

// The columns each sheet is read for, every header string defined exactly once.
// Object.values(MAP) is the required-columns list asserted at the read boundary
// (a renamed/mis-typed header fails loud instead of silently reading "" and
// dropping every row); every read below goes through MAP.<key>, so a source
// column rename is a one-line change here.
const DEPARTMENT = {
  number: "DEPARTMENT_NUMBER",
  name: "DEPARTMENT_NAME",
  state: "STATE",
  status: "STATUS",
  addressLine1: "ADD_LINE1",
  addressLine2: "ADD_LINE2",
  city: "CITY",
  zip: "ZIP_CODE",
  headName: "HEAD_NAME",
  email: "E_MAIL",
  phone: "PHONE",
  fax: "FAX",
} as const;
const SERVICE = {
  publicGuid: "PUBLIC_GUID",
  departmentNumber: "DEPARTMENT_NUMBER",
  appointment: "APPOINTMENT",
  license: "LICENSE",
  startDate: "ST_DATE",
  endDate: "END_DATE",
} as const;
const OFFICER = {
  publicGuid: "PUBLIC_GUID",
  firstName: "FNAME",
  lastName: "LNAME",
  middleName: "MNAME",
  suffix: "SFX",
} as const;
const ACTION = {
  publicGuid: "PUBLIC_GUID",
  license: "LICENSE",
  dateAwarded: "DATE_AWARDED",
  actionDate: "ACTION_DATE",
  action: "LICENSE_ACTION",
  status: "LICENSE_STATUS",
} as const;

export const run: SourceRun = async ({ paths, readXlsx, logger }) => {
  const log = logger ?? { info() {} };
  const workbook = paths.find((path) => path.toLowerCase().endsWith(".xlsx"));
  if (workbook === undefined) {
    throw new Error("gov.tx.tcole expects a single .xlsx workbook input.");
  }

  // Agencies: STATUS = ACTIVE only (the original seed omitted the 953 inactive
  // departments). Everything else cascades from that decision.
  log.info("tcole: reading Departments sheet");
  const departmentRows = await readXlsx(
    workbook,
    "Departments",
    Object.values(DEPARTMENT),
  );
  const agencies = buildAgencies(departmentRows);
  log.info(`tcole: ${Object.keys(agencies).length} active agencies`);
  const agencyPhoneNumbers = buildAgencyPhoneNumbers(departmentRows, agencies);

  // Only officers attached to an active agency are imported: an officer is kept
  // iff some Services row links them to an emitted (active) agency. Officers with
  // no services, or only services at inactive agencies, are dropped.
  log.info("tcole: reading Services sheet");
  const serviceRows = await readXlsx(
    workbook,
    "Services",
    Object.values(SERVICE),
  );
  log.info(`tcole: ${serviceRows.length} service rows`);
  const activeOfficerGuids = new Set<string>();
  for (const row of serviceRows) {
    const departmentNumber = (row[SERVICE.departmentNumber] ?? "").trim();
    const publicGuid = (row[SERVICE.publicGuid] ?? "").trim();
    if (publicGuid !== "" && agencies[departmentNumber] !== undefined) {
      activeOfficerGuids.add(publicGuid);
    }
  }

  log.info("tcole: reading Officers sheet");
  const personnel = buildPersonnel(
    await readXlsx(workbook, "Officers", Object.values(OFFICER)),
    activeOfficerGuids,
  );
  log.info(`tcole: ${Object.keys(personnel).length} active officers`);

  // Per-license history rows (one per licensing action). Sheet is optional; a
  // workbook without it simply yields no Licenses/LicenseActions.
  log.info("tcole: reading OfficersLicensesActions sheet");
  const licenseActionRows = await readXlsx(
    workbook,
    "OfficersLicensesActions",
    Object.values(ACTION),
  );

  log.info("tcole: building records");
  const licensingAuthorities = buildLicensingAuthorities();
  const licenses = buildLicenses(serviceRows, licenseActionRows, personnel);
  const licenseActions = buildLicenseActions(
    licenseActionRows,
    personnel,
    licenses,
  );
  const agencyPersonnel = buildAgencyPersonnel(
    serviceRows,
    agencies,
    personnel,
    licenses,
  );
  log.info(
    `tcole: ${Object.keys(licenses).length} licenses, ` +
      `${Object.keys(licenseActions).length} license actions, ` +
      `${Object.keys(agencyPersonnel).length} assignments, ` +
      `${Object.keys(agencyPhoneNumbers).length} phone numbers`,
  );

  return {
    artifacts: [
      { kind: "LicensingAuthorities", records: licensingAuthorities },
      { kind: "Agencies", records: agencies },
      { kind: "Personnel", records: personnel },
      { kind: "Licenses", records: licenses },
      { kind: "LicenseActions", records: licenseActions },
      { kind: "AgencyPersonnel", records: agencyPersonnel },
      { kind: "AgencyPhoneNumbers", records: agencyPhoneNumbers },
    ],
  };
};

/**
 * One AgencyPhoneNumber per non-blank PHONE/FAX on an active department, keyed
 * `DEPARTMENT_NUMBER|Phone` / `DEPARTMENT_NUMBER|Fax` so the id is stable and a
 * department's phone and fax are distinct records. `agency_id` carries the
 * DEPARTMENT_NUMBER source key the import resolves to the canonical agency.
 */
function buildAgencyPhoneNumbers(
  rows: Array<Record<string, string>>,
  agencies: EmittedRecords,
): EmittedRecords {
  const records: EmittedRecords = {};
  for (const row of rows) {
    const departmentNumber = (row[DEPARTMENT.number] ?? "").trim();
    if (agencies[departmentNumber] === undefined) continue;
    for (const [column, description] of [
      [DEPARTMENT.phone, "Phone"],
      [DEPARTMENT.fax, "Fax"],
    ] as const) {
      const phoneNumber = (row[column] ?? "").trim();
      if (phoneNumber === "") continue;
      records[`${departmentNumber}|${description}`] = {
        spec: {
          agency_id: departmentNumber,
          phone_number: phoneNumber,
          description,
        },
      };
    }
  }
  return records;
}

/** Trims to `YYYY-MM-DD`; `readXlsx` coerces date cells to ISO strings. */
function toDate(value: string | undefined): string {
  const text = (value ?? "").trim();
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function nullIfBlank(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  // TCOLE uses the literal string "NULL"/"Null"/"null" as a missing-value
  // sentinel; treat it (and a blank) as an absent value.
  return text === "" || text.toLowerCase() === "null" ? null : text;
}

function buildPersonnel(
  rows: Array<Record<string, string>>,
  activeOfficerGuids: ReadonlySet<string>,
): EmittedRecords {
  const records: EmittedRecords = {};
  for (const row of rows) {
    const publicGuid = (row[OFFICER.publicGuid] ?? "").trim();
    const firstName = nullIfBlank(row[OFFICER.firstName]);
    // Only import officers attached to an active agency.
    if (!activeOfficerGuids.has(publicGuid)) continue;
    // Personnel spec requires a stable id and a first name. last_name is
    // nullable: TCOLE sometimes has no last name (sentinel "NULL"), and dropping
    // those would drop real (often active) officers.
    if (publicGuid === "" || firstName === null) continue;
    records[publicGuid] = {
      spec: {
        id: publicGuid,
        first_name: firstName,
        last_name: nullIfBlank(row[OFFICER.lastName]),
        middle_name: nullIfBlank(row[OFFICER.middleName]),
        suffix: nullIfBlank(row[OFFICER.suffix]),
      },
    };
  }
  return records;
}

function buildAgencies(rows: Array<Record<string, string>>): EmittedRecords {
  const records: EmittedRecords = {};
  for (const row of rows) {
    const departmentNumber = (row[DEPARTMENT.number] ?? "").trim();
    const name = (row[DEPARTMENT.name] ?? "").trim();
    const state = (row[DEPARTMENT.state] ?? "").trim();
    // Only active agencies are imported (the original seed omitted inactive
    // departments). Everything downstream cascades from this filter.
    if ((row[DEPARTMENT.status] ?? "").trim().toUpperCase() !== "ACTIVE")
      continue;
    // Agency spec requires a non-empty name and state; the key must be stable.
    if (departmentNumber === "" || name === "" || state === "") continue;

    const address = [row[DEPARTMENT.addressLine1], row[DEPARTMENT.addressLine2]]
      .map((part) => (part ?? "").trim())
      .filter((part) => part !== "")
      .join(", ");
    // Phone/fax are not columns of public.agency (they belong to
    // agency_phone_numbers, out of scope here), so they are not emitted.
    records[departmentNumber] = {
      spec: {
        name,
        state,
        city: nullIfBlank(row[DEPARTMENT.city]),
        address: address === "" ? null : address,
        zip_code: nullIfBlank(row[DEPARTMENT.zip]),
        contact_name: nullIfBlank(row[DEPARTMENT.headName]),
        contact_email: nullIfBlank(row[DEPARTMENT.email]),
      },
    };
  }
  return records;
}

function buildAgencyPersonnel(
  rows: Array<Record<string, string>>,
  agencies: EmittedRecords,
  personnel: EmittedRecords,
  licenses: EmittedRecords,
): EmittedRecords {
  const records: EmittedRecords = {};
  for (const row of rows) {
    const publicGuid = (row[SERVICE.publicGuid] ?? "").trim();
    const departmentNumber = (row[SERVICE.departmentNumber] ?? "").trim();
    const appointment = (row[SERVICE.appointment] ?? "").trim();
    const license = (row[SERVICE.license] ?? "").trim();
    const startDate = toDate(row[SERVICE.startDate]);
    const endDate = toDate(row[SERVICE.endDate]);

    // Required fields for AgencyPersonnel: agency_id, personnel_id, start_date,
    // title (the role). A blank APPOINTMENT is retained as title "Unknown"
    // (below) rather than dropped — we still know the person served at the
    // agency over that period. start_date has no sentinel (NOT NULL date), so a
    // blank one is still skipped. Referential integrity: the referenced agency
    // and officer must have been emitted so the transform can resolve them.
    if (publicGuid === "" || departmentNumber === "" || startDate === "") {
      continue;
    }
    if (
      agencies[departmentNumber] === undefined ||
      personnel[publicGuid] === undefined
    ) {
      continue;
    }

    // Synthetic identity key — matches the prior identity map's `id_field`
    // byte-for-byte (empty segment when a field is blank) so seed IDs are
    // preserved: PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE.
    // The raw APPOINTMENT segment is used here even when blank — the "Unknown"
    // fallback applies to the `title` value only, never to the key.
    const key = [
      publicGuid,
      departmentNumber,
      appointment,
      license,
      startDate,
      endDate,
    ].join("|");

    // Link to the emitted License (PUBLIC_GUID|LICENSE). A blank LICENSE has no
    // license; a non-blank LICENSE whose License was not emitted (e.g. the
    // officer/license was filtered) is left null rather than dangling.
    const licenseKey = `${publicGuid}|${license}`;
    const licenseId =
      license === "" || licenses[licenseKey] === undefined ? null : licenseKey;

    records[key] = {
      spec: {
        agency_id: departmentNumber,
        personnel_id: publicGuid,
        start_date: startDate,
        end_date: endDate === "" ? null : endDate,
        // `title` holds the role (APPOINTMENT). Blank roles are recorded as
        // "Unknown" so the assignment is kept rather than dropped.
        title: appointment === "" ? "Unknown" : appointment,
        license_id: licenseId,
      },
    };
  }
  return records;
}

/**
 * Emits the single licensing authority this source has data for: TCOLE. Per ADR
 * 0015 a source emits only its own authorities, using namespace-local names —
 * there is no shared/curated authority dataset. `location_path_id` is the
 * namespace-local state value (`"tx"`); the intake root maps it to the canonical
 * TX location_path (resolve-or-fail, ADR 0006). The source never sees a
 * canonical id.
 */
function buildLicensingAuthorities(): EmittedRecords {
  return {
    tcole: {
      spec: {
        name: "Texas Commission on Law Enforcement",
        abbreviation: "TCOLE",
        website: "https://www.tcole.texas.gov",
        location_path_id: "tx",
      },
    },
  };
}

/**
 * Emits one License per distinct PUBLIC_GUID×LICENSE seen in either the
 * OfficersLicensesActions history or the Services roster, for officers that
 * were emitted (active cascade). Keyed by `PUBLIC_GUID|LICENSE`.
 *
 * `first_awarded` is the authoritative `DATE_AWARDED` from the actions history
 * (constant per license) when available, else null. `status` is the
 * `LICENSE_STATUS` recorded by the latest action (by ACTION_DATE) — the license's
 * current standing. Both are null for a license seen only in the Services roster,
 * which carries no action history. All TCOLE licenses are issued by `tcole`.
 */
function buildLicenses(
  serviceRows: Array<Record<string, string>>,
  licenseActionRows: Array<Record<string, string>>,
  personnel: EmittedRecords,
): EmittedRecords {
  // Per PUBLIC_GUID|LICENSE, in one pass over the action history: the award date
  // (authoritative DATE_AWARDED) and the current status (LICENSE_STATUS at the
  // latest ACTION_DATE; a later row at a tied date wins).
  const awardDate = new Map<string, string>();
  const latestActionDate = new Map<string, string>();
  const currentStatus = new Map<string, string>();
  for (const row of licenseActionRows) {
    const publicGuid = (row[ACTION.publicGuid] ?? "").trim();
    const license = (row[ACTION.license] ?? "").trim();
    if (publicGuid === "" || license === "") continue;
    const key = `${publicGuid}|${license}`;

    const dateAwarded = toDate(row[ACTION.dateAwarded]);
    if (dateAwarded !== "" && !awardDate.has(key))
      awardDate.set(key, dateAwarded);

    const actionDate = toDate(row[ACTION.actionDate]);
    const status = (row[ACTION.status] ?? "").trim();
    if (actionDate !== "") {
      const latest = latestActionDate.get(key);
      if (latest === undefined || actionDate >= latest) {
        latestActionDate.set(key, actionDate);
        if (status !== "") currentStatus.set(key, status);
      }
    }
  }

  const records: EmittedRecords = {};
  for (const row of [...licenseActionRows, ...serviceRows]) {
    // PUBLIC_GUID and LICENSE are the same header on both sheets.
    const publicGuid = (row[ACTION.publicGuid] ?? "").trim();
    const license = (row[ACTION.license] ?? "").trim();
    // Skip blanks and officers not emitted by the active cascade.
    if (publicGuid === "" || license === "") continue;
    if (personnel[publicGuid] === undefined) continue;

    const key = `${publicGuid}|${license}`;
    if (records[key] !== undefined) continue;

    records[key] = {
      spec: {
        personnel_id: publicGuid,
        license_type: license,
        status: currentStatus.get(key) ?? null,
        first_awarded: awardDate.get(key) ?? null,
        issued_by_authority_id: "tcole",
      },
    };
  }
  return records;
}

/**
 * Emits one LicenseAction per OfficersLicensesActions row whose officer and
 * license were emitted. Keyed by the tuple
 * `PUBLIC_GUID|LICENSE|LICENSE_ACTION|ACTION_DATE`. `license_id` references the emitted
 * License by its `PUBLIC_GUID|LICENSE` key; rows referencing an unemitted
 * license are skipped so no reference dangles.
 */
function buildLicenseActions(
  rows: Array<Record<string, string>>,
  personnel: EmittedRecords,
  licenses: EmittedRecords,
): EmittedRecords {
  const records: EmittedRecords = {};
  for (const row of rows) {
    const publicGuid = (row[ACTION.publicGuid] ?? "").trim();
    const license = (row[ACTION.license] ?? "").trim();
    const action = (row[ACTION.action] ?? "").trim();
    const actionDate = toDate(row[ACTION.actionDate]);
    const status = (row[ACTION.status] ?? "").trim();

    if (publicGuid === "" || license === "" || action === "") continue;
    if (personnel[publicGuid] === undefined) continue;
    const licenseKey = `${publicGuid}|${license}`;
    if (licenses[licenseKey] === undefined) continue;

    const key = `${publicGuid}|${license}|${action}|${actionDate}`;
    records[key] = {
      spec: {
        license_id: licenseKey,
        action,
        action_date: actionDate === "" ? null : actionDate,
        status: status === "" ? null : status,
      },
    };
  }
  return records;
}
