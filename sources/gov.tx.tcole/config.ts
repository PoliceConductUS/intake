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
 * `license_type` carries the `APPOINTMENT` (the role — "Peace Officer", "Chief
 * of Police"), matching how the column is populated today (seed set
 * `agency_officers.title = APPOINTMENT`; that column was later renamed to
 * `license_type`). A follow-up change renames it back to `title` and adds a
 * separate license reference.
 *
 * Deterministic: no network, clock, or randomness. Cross-references
 * (`agency_id`, `personnel_id`) carry TCOLE source keys that the import
 * transform resolves to canonical IDs via the ledger; every referenced agency
 * and officer is emitted here so no reference is left unmapped.
 */
export const run: SourceRun = async ({ paths, readXlsx }) => {
  const workbook = paths.find((path) => path.toLowerCase().endsWith(".xlsx"));
  if (workbook === undefined) {
    throw new Error("gov.tx.tcole expects a single .xlsx workbook input.");
  }

  const personnel = buildPersonnel(await readXlsx(workbook, "Officers"));
  const agencies = buildAgencies(await readXlsx(workbook, "Departments"));
  const agencyPersonnel = buildAgencyPersonnel(
    await readXlsx(workbook, "Services"),
    agencies,
    personnel,
  );

  return {
    artifacts: [
      { kind: "Agencies", records: agencies },
      { kind: "Personnel", records: personnel },
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
  return text === "" ? null : text;
}

function buildPersonnel(rows: Array<Record<string, string>>): EmittedRecords {
  const records: EmittedRecords = {};
  for (const row of rows) {
    const publicGuid = (row["PUBLIC_GUID"] ?? "").trim();
    const firstName = (row["FNAME"] ?? "").trim();
    const lastName = (row["LNAME"] ?? "").trim();
    // Personnel spec requires a stable id and non-empty first/last name.
    if (publicGuid === "" || firstName === "" || lastName === "") continue;
    records[publicGuid] = {
      spec: {
        id: publicGuid,
        first_name: firstName,
        last_name: lastName,
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
    // Agency spec requires a non-empty name and state; the key must be stable.
    if (departmentNumber === "" || name === "" || state === "") continue;

    const address = [row["ADD_LINE1"], row["ADD_LINE2"]]
      .map((part) => (part ?? "").trim())
      .filter((part) => part !== "")
      .join(", ");
    const phone = (row["PHONE"] ?? "").trim();
    const fax = (row["FAX"] ?? "").trim();
    const phones: Record<string, string> = {};
    if (phone !== "") phones.main = phone;
    if (fax !== "") phones.fax = fax;

    records[departmentNumber] = {
      spec: {
        name,
        state,
        city: nullIfBlank(row["CITY"]),
        address: address === "" ? null : address,
        zip_code: nullIfBlank(row["ZIP_CODE"]),
        contact_name: nullIfBlank(row["HEAD_NAME"]),
        contact_email: nullIfBlank(row["E_MAIL"]),
        ...(Object.keys(phones).length > 0 ? { phones } : {}),
      },
    };
  }
  return records;
}

function buildAgencyPersonnel(
  rows: Array<Record<string, string>>,
  agencies: EmittedRecords,
  personnel: EmittedRecords,
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
    // license_type (the role). Referential integrity: the referenced agency and
    // officer must have been emitted so the transform can resolve them.
    if (
      publicGuid === "" ||
      departmentNumber === "" ||
      appointment === "" ||
      startDate === ""
    ) {
      continue;
    }
    if (
      agencies[departmentNumber] === undefined ||
      personnel[publicGuid] === undefined
    ) {
      continue;
    }

    // Synthetic identity key — matches the prior identity map's `id_field`:
    // PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE
    const key = [
      publicGuid,
      departmentNumber,
      appointment,
      license,
      startDate,
      endDate,
    ].join("|");

    records[key] = {
      spec: {
        agency_id: departmentNumber,
        personnel_id: publicGuid,
        start_date: startDate,
        end_date: endDate === "" ? null : endDate,
        // license_type currently holds the role (APPOINTMENT); renamed to
        // `title` in a follow-up change.
        license_type: appointment,
      },
    };
  }
  return records;
}
