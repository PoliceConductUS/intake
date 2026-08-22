import type {
  SourceRun,
  EmittedRecords,
} from "../../src/cli/run/source-run.js";

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
 * `agency_officers.title = APPOINTMENT`). A blank APPOINTMENT is recorded as
 * "Unknown" rather than dropped. The separate license reference
 * (`agency_officers.license_id`) links to the emitted License
 * (`PUBLIC_GUID|LICENSE`) when the assignment carries a non-blank LICENSE.
 *
 * The licensing model adds three more kinds — `LicensingAuthorities` (just
 * TCOLE, the one authority this source has data for; per ADR 0015 a source emits
 * only its own authorities, with no shared/curated dataset), `Licenses` (distinct
 * `PUBLIC_GUID`×`LICENSE`, keyed `PUBLIC_GUID|LICENSE`), and `LicenseActions`
 * (one per `OfficersLicensesActions` row, keyed
 * `PUBLIC_GUID|LICENSE|ACTION|ACTION_DATE`).
 *
 * Deterministic: no network, clock, or randomness. Cross-references
 * (`agency_id`, `personnel_id`) carry TCOLE source keys that the import
 * transform resolves to canonical IDs via the ledger; every referenced agency
 * and officer is emitted here so no reference is left unmapped.
 */
export const description =
  "Texas TCOLE — agencies, officers, licenses, and assignments reconstructed from the TCOLE public-information workbook.";

export const run: SourceRun = async ({ paths, readXlsx, logger }) => {
  const log = logger ?? { info() {} };
  const workbook = paths.find((path) => path.toLowerCase().endsWith(".xlsx"));
  if (workbook === undefined) {
    throw new Error("gov.tx.tcole expects a single .xlsx workbook input.");
  }

  // Agencies: STATUS = ACTIVE only (the original seed omitted the 953 inactive
  // departments). Everything else cascades from that decision.
  log.info("tcole: reading Departments sheet");
  const agencies = buildAgencies(await readXlsx(workbook, "Departments"));
  log.info(`tcole: ${Object.keys(agencies).length} active agencies`);

  // Only officers attached to an active agency are imported: an officer is kept
  // iff some Services row links them to an emitted (active) agency. Officers with
  // no services, or only services at inactive agencies, are dropped.
  log.info("tcole: reading Services sheet");
  const serviceRows = await readXlsx(workbook, "Services");
  log.info(`tcole: ${serviceRows.length} service rows`);
  const activeOfficerGuids = new Set<string>();
  for (const row of serviceRows) {
    const departmentNumber = (row["DEPARTMENT_NUMBER"] ?? "").trim();
    const publicGuid = (row["PUBLIC_GUID"] ?? "").trim();
    if (publicGuid !== "" && agencies[departmentNumber] !== undefined) {
      activeOfficerGuids.add(publicGuid);
    }
  }

  log.info("tcole: reading Officers sheet");
  const personnel = buildPersonnel(
    await readXlsx(workbook, "Officers"),
    activeOfficerGuids,
  );
  log.info(`tcole: ${Object.keys(personnel).length} active officers`);

  // Per-license history rows (one per licensing action). Sheet is optional; a
  // workbook without it simply yields no Licenses/LicenseActions.
  log.info("tcole: reading OfficersLicensesActions sheet");
  const licenseActionRows = await readXlsx(workbook, "OfficersLicensesActions");

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
      `${Object.keys(agencyPersonnel).length} assignments`,
  );

  return {
    artifacts: [
      { kind: "LicensingAuthorities", records: licensingAuthorities },
      { kind: "Agencies", records: agencies },
      { kind: "Personnel", records: personnel },
      { kind: "Licenses", records: licenses },
      { kind: "LicenseActions", records: licenseActions },
      { kind: "AgencyPersonnel", records: agencyPersonnel },
    ],
  };
};

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
    const publicGuid = (row["PUBLIC_GUID"] ?? "").trim();
    const firstName = nullIfBlank(row["FNAME"]);
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
        last_name: nullIfBlank(row["LNAME"]),
        middle_name: nullIfBlank(row["MNAME"]),
        suffix: nullIfBlank(row["SFX"]),
      },
    };
  }
  return records;
}

function buildAgencies(rows: Array<Record<string, string>>): EmittedRecords {
  const records: EmittedRecords = {};
  for (const row of rows) {
    const departmentNumber = (row["DEPARTMENT_NUMBER"] ?? "").trim();
    const name = (row["DEPARTMENT_NAME"] ?? "").trim();
    const state = (row["STATE"] ?? "").trim();
    // Only active agencies are imported (the original seed omitted inactive
    // departments). Everything downstream cascades from this filter.
    if ((row["STATUS"] ?? "").trim().toUpperCase() !== "ACTIVE") continue;
    // Agency spec requires a non-empty name and state; the key must be stable.
    if (departmentNumber === "" || name === "" || state === "") continue;

    const address = [row["ADD_LINE1"], row["ADD_LINE2"]]
      .map((part) => (part ?? "").trim())
      .filter((part) => part !== "")
      .join(", ");
    // Phone/fax are not columns of public.agency (they belong to
    // agency_phone_numbers, out of scope here), so they are not emitted.
    records[departmentNumber] = {
      spec: {
        name,
        state,
        city: nullIfBlank(row["CITY"]),
        address: address === "" ? null : address,
        zip_code: nullIfBlank(row["ZIP_CODE"]),
        contact_name: nullIfBlank(row["HEAD_NAME"]),
        contact_email: nullIfBlank(row["E_MAIL"]),
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
    const publicGuid = (row["PUBLIC_GUID"] ?? "").trim();
    const departmentNumber = (row["DEPARTMENT_NUMBER"] ?? "").trim();
    const appointment = (row["APPOINTMENT"] ?? "").trim();
    const license = (row["LICENSE"] ?? "").trim();
    const startDate = toDate(row["ST_DATE"]);
    const endDate = toDate(row["END_DATE"]);

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
        officer_id: publicGuid,
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
 * were emitted (active cascade). Keyed by `PUBLIC_GUID|LICENSE`. `first_awarded`
 * is the earliest OfficersLicensesActions ACTION_DATE for that pair when
 * available, else null. All TCOLE licenses are issued by `tcole`.
 */
function buildLicenses(
  serviceRows: Array<Record<string, string>>,
  licenseActionRows: Array<Record<string, string>>,
  personnel: EmittedRecords,
): EmittedRecords {
  // Earliest ACTION_DATE per PUBLIC_GUID|LICENSE (cheap single pass).
  const earliestActionDate = new Map<string, string>();
  for (const row of licenseActionRows) {
    const publicGuid = (row["PUBLIC_GUID"] ?? "").trim();
    const license = (row["LICENSE"] ?? "").trim();
    const actionDate = toDate(row["ACTION_DATE"]);
    if (publicGuid === "" || license === "" || actionDate === "") continue;
    const key = `${publicGuid}|${license}`;
    const current = earliestActionDate.get(key);
    if (current === undefined || actionDate < current) {
      earliestActionDate.set(key, actionDate);
    }
  }

  const records: EmittedRecords = {};
  for (const row of [...licenseActionRows, ...serviceRows]) {
    const publicGuid = (row["PUBLIC_GUID"] ?? "").trim();
    const license = (row["LICENSE"] ?? "").trim();
    // Skip blanks and officers not emitted by the active cascade.
    if (publicGuid === "" || license === "") continue;
    if (personnel[publicGuid] === undefined) continue;

    const key = `${publicGuid}|${license}`;
    if (records[key] !== undefined) continue;

    records[key] = {
      spec: {
        officer_id: publicGuid,
        license_type: license,
        status: null,
        first_awarded: earliestActionDate.get(key) ?? null,
        issued_by_authority_id: "tcole",
      },
    };
  }
  return records;
}

/**
 * Emits one LicenseAction per OfficersLicensesActions row whose officer and
 * license were emitted. Keyed by the tuple
 * `PUBLIC_GUID|LICENSE|ACTION|ACTION_DATE`. `license_id` references the emitted
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
    const publicGuid = (row["PUBLIC_GUID"] ?? "").trim();
    const license = (row["LICENSE"] ?? "").trim();
    const action = (row["ACTION"] ?? "").trim();
    const actionDate = toDate(row["ACTION_DATE"]);
    const status = (row["STATUS"] ?? "").trim();

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
