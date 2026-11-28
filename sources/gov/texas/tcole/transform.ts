import { basename } from "node:path";
import { moduleSourceNamespace } from "../../../../src/cli/source-namespace.js";
import { normalizeTextWhitespace } from "../../../../src/shared/text.js";
import type { InputAccounting } from "../../../../src/cli/transform/accounting.js";
import type {
  SourceTransform,
  EmittedRecords,
} from "../../../../src/cli/transform/source-transform.js";
import type { Finding } from "../../../../src/shared/data-annotations.js";
import { AgencySpec } from "../../../../src/shared/io/index.js";
import { canonicalLicenseType } from "../../../../src/shared/license.js";

const SOURCE = moduleSourceNamespace(import.meta.url);

// TCOLE is the one licensing authority this source has data for.
const TCOLE_AUTHORITY = "tcole";

// A license's source keys: the authority_license (authority + canonical type) and
// the officer's holding of it. Canonical so spelling/suffix variants converge.
function authorityLicenseKey(license: string): string {
  return `${TCOLE_AUTHORITY}|${canonicalLicenseType(license)}`;
}
function licenseHoldingKey(publicGuid: string, license: string): string {
  return `${publicGuid}|${canonicalLicenseType(license)}`;
}

/**
 * TX POST (TCOLE) — reconstructs the Texas rows of the database from a single
 * TCOLE Public-Information-Act workbook
 * (`PublicInformationRequest_2025-02-10_1410.xlsx`). Four sheets are read. Three map
 * onto these import kinds:
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
 * "Unknown" with a finding on the record. The separate license reference
 * (`agency_personnel.license_id`) links to the emitted License
 * (`PUBLIC_GUID|<canonical license type>`).
 *
 * The licensing model adds three more kinds — `LicensingAuthorities` (just
 * TCOLE, the one authority this source has data for; per ADR 0015 a source emits
 * only its own authorities, with no shared/curated dataset), `Licenses` (distinct
 * `PUBLIC_GUID`×`LICENSE`, keyed `PUBLIC_GUID|<canonical license type>`), and
 * `LicenseActions` (one per `OfficersLicensesActions` row, keyed
 * `PUBLIC_GUID|<canonical license type>|LICENSE_ACTION|ACTION_DATE`). `PHONE`
 * and `FAX` of an emitted department become `AgencyPhoneNumbers`.
 *
 * Deterministic: no network, clock, or randomness. Cross-references
 * (`agency_id`, `personnel_id`) carry TCOLE source keys that the import
 * transform resolves to canonical IDs via the ledger; every referenced agency
 * and officer is emitted here so no reference is left unmapped.
 *
 * Every row ends in one outcome (openspec `source-left-out-records`): emitted,
 * reported as a finding on the TCOLE licensing authority, or an error.
 */

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
  statusDate: "DATE_OFFICIAL",
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

type Row = Record<string, string>;
type Input = {
  sheet: string;
  workbook: string;
  rows: Row[];
  accounting: InputAccounting;
};
type LeftOut = Map<string, Finding>;

const rowNumber = (index: number) => index + 2;

function readColumns(row: Row, columns: Record<string, string>) {
  return Object.fromEntries(
    Object.values(columns).map((column) => [column, row[column]]),
  );
}

function finding(
  input: Input,
  index: number,
  fields: Pick<
    Finding,
    "code" | "field" | "value" | "message" | "source_record_id"
  >,
): Finding {
  return {
    type: "warning",
    ...fields,
    evidence: [
      { workbook: input.workbook, sheet: input.sheet, row: rowNumber(index) },
    ],
    source_namespace: SOURCE,
  };
}

function assertNoConflict(
  seen: Map<string, string>,
  input: Input,
  index: number,
  key: string,
  content: unknown,
): void {
  const text = JSON.stringify(content);
  const earlier = seen.get(key);
  if (earlier !== undefined && earlier !== text) {
    throw new Error(
      `${SOURCE}: ${input.sheet} row ${rowNumber(index)} repeats key ${key} with different content.`,
    );
  }
  seen.set(key, text);
}

function assertKnown(
  input: Input,
  index: number,
  column: string,
  value: string,
  sheet: string,
  emitted: EmittedRecords,
  leftOut: LeftOut,
): void {
  if (emitted[value] === undefined && !leftOut.has(value)) {
    throw new Error(
      `${SOURCE}: ${input.sheet} row ${rowNumber(index)} names ${column} ${value}, which is not in the ${sheet} sheet.`,
    );
  }
}

export const transform: SourceTransform = async ({
  paths,
  readXlsx,
  logger,
}) => {
  const log = logger ?? { info() {} };
  const workbooks = paths.filter((path) =>
    path.toLowerCase().endsWith(".xlsx"),
  );
  const workbook = workbooks[0];
  if (workbook === undefined || workbooks.length > 1) {
    throw new Error(
      `${SOURCE} expects a single .xlsx workbook input, got ${workbooks.length}${workbooks.length === 0 ? "." : `: ${workbooks.join(", ")}`}`,
    );
  }

  const read = async (
    sheet: string,
    columns: Record<string, string>,
    idColumns: string[],
  ): Promise<Input> => {
    log.info(`tcole: reading ${sheet} sheet`);
    const rows = await readXlsx(workbook, sheet, Object.values(columns));
    rows.forEach((row, index) => {
      for (const column of idColumns) {
        if ((row[column] ?? "").trim() === "") {
          throw new Error(
            `${SOURCE}: ${sheet} row ${rowNumber(index)} has a blank ${column}.`,
          );
        }
      }
    });
    return {
      sheet,
      workbook: basename(workbook),
      rows,
      accounting: {
        input: sheet,
        read: rows.length,
        emitted: 0,
        reported: 0,
        notSelected: {},
      },
    };
  };

  // Emit candidates; the shared import pipeline determines agency eligibility.
  const departments = await read("Departments", DEPARTMENT, [
    DEPARTMENT.number,
  ]);
  const leftOutDepartments: LeftOut = new Map();
  const agencies = buildAgencies(departments, leftOutDepartments, log);
  log.info(`tcole: ${Object.keys(agencies).length} agency candidates`);
  const agencyPhoneNumbers = buildAgencyPhoneNumbers(
    departments.rows,
    agencies,
  );

  // Preserve service history for shared assignment-based selection.
  const services = await read("Services", SERVICE, [
    SERVICE.publicGuid,
    SERVICE.departmentNumber,
    SERVICE.license,
  ]);
  log.info(`tcole: ${services.rows.length} service rows`);
  const officers = await read("Officers", OFFICER, [OFFICER.publicGuid]);
  const leftOutOfficers: LeftOut = new Map();
  const personnel = buildPersonnel(officers, leftOutOfficers);
  log.info(`tcole: ${Object.keys(personnel).length} personnel candidates`);

  // Per-license history rows (one per licensing action).
  const actions = await read("OfficersLicensesActions", ACTION, [
    ACTION.publicGuid,
    ACTION.license,
    ACTION.action,
  ]);

  log.info("tcole: building records");
  const authorityLicenses = buildAuthorityLicenses(
    services.rows,
    actions.rows,
    personnel,
  );
  const licenses = buildLicenses(services.rows, actions, personnel);
  const licenseActions = buildLicenseActions(
    actions,
    personnel,
    leftOutOfficers,
  );
  const leftOutServices: LeftOut = new Map();
  const agencyPersonnel = buildAgencyPersonnel(
    services,
    agencies,
    personnel,
    leftOutDepartments,
    leftOutOfficers,
    leftOutServices,
  );
  const licensingAuthorities = buildLicensingAuthorities([
    ...leftOutDepartments.values(),
    ...leftOutOfficers.values(),
    ...leftOutServices.values(),
  ]);
  log.info(
    `tcole: ${Object.keys(licenses).length} licenses, ` +
      `${Object.keys(licenseActions).length} license actions, ` +
      `${Object.keys(agencyPersonnel).length} assignments, ` +
      `${Object.keys(agencyPhoneNumbers).length} phone numbers`,
  );

  return {
    artifacts: [
      { kind: "LicensingAuthorities", records: licensingAuthorities },
      { kind: "AuthorityLicenses", records: authorityLicenses },
      { kind: "Agencies", records: agencies },
      { kind: "Personnel", records: personnel },
      { kind: "Licenses", records: licenses },
      { kind: "LicenseActions", records: licenseActions },
      { kind: "AgencyPersonnel", records: agencyPersonnel },
      { kind: "AgencyPhoneNumbers", records: agencyPhoneNumbers },
    ],
    accounting: [
      departments.accounting,
      officers.accounting,
      services.accounting,
      actions.accounting,
    ],
  };
};

/**
 * One AgencyPhoneNumber per non-blank PHONE/FAX on an emitted department, keyed
 * `DEPARTMENT_NUMBER|Phone` / `DEPARTMENT_NUMBER|Fax` so the id is stable and a
 * department's phone and fax are distinct records. `agency_id` carries the
 * DEPARTMENT_NUMBER source key the import resolves to the canonical agency.
 */
function buildAgencyPhoneNumbers(
  rows: Row[],
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
function toDate(input: Input, index: number, column: string): string {
  const text = (input.rows[index]?.[column] ?? "").trim();
  if (text === "") return "";
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (match === null) {
    throw new Error(
      `${SOURCE}: ${input.sheet} row ${rowNumber(index)} ${column} is not a date: ${text}`,
    );
  }
  return match[0];
}

function nullIfBlank(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  // TCOLE uses the literal string "NULL"/"Null"/"null" as a missing-value
  // sentinel; treat it (and a blank) as an absent value.
  return text === "" || text.toLowerCase() === "null" ? null : text;
}

function buildPersonnel(input: Input, leftOut: LeftOut): EmittedRecords {
  const records: EmittedRecords = {};
  const seen = new Map<string, string>();
  for (const [index, row] of input.rows.entries()) {
    const publicGuid = (row[OFFICER.publicGuid] ?? "").trim();
    const source = readColumns(row, OFFICER);
    assertNoConflict(seen, input, index, publicGuid, source);
    const firstName = nullIfBlank(row[OFFICER.firstName]);
    // Personnel spec requires a first name. last_name is nullable: TCOLE
    // sometimes has no last name (sentinel "NULL").
    if (firstName === null) {
      if (!leftOut.has(publicGuid)) {
        leftOut.set(
          publicGuid,
          finding(input, index, {
            code: "officer-not-buildable",
            field: "personnel",
            value: source,
            message: `Officer record ${publicGuid} is in the commission's records but is not listed here because it has no first name. The officer's licenses and service are not listed either.`,
            source_record_id: publicGuid,
          }),
        );
      }
      input.accounting.reported += 1;
      continue;
    }
    // Preserve candidates for mandatory shared validation and audited exclusions.
    records[publicGuid] = {
      spec: {
        id: publicGuid,
        first_name: firstName,
        last_name: nullIfBlank(row[OFFICER.lastName]),
        middle_name: nullIfBlank(row[OFFICER.middleName]),
        suffix: nullIfBlank(row[OFFICER.suffix]),
      },
    };
    input.accounting.emitted += 1;
  }
  return records;
}

const AGENCY_FIELD_WORDS: Record<string, string> = {
  name: "name",
  state: "state",
  city: "city",
  address: "address",
  zip_code: "ZIP code",
  contact_name: "contact name",
  contact_email: "contact email",
  status: "status",
  status_date: "status date",
};

function buildAgencies(
  input: Input,
  leftOut: LeftOut,
  log: { info: (message: string) => void },
): EmittedRecords {
  const records: EmittedRecords = {};
  const seen = new Map<string, string>();
  for (const [index, row] of input.rows.entries()) {
    const departmentNumber = (row[DEPARTMENT.number] ?? "").trim();
    const source = readColumns(row, DEPARTMENT);
    assertNoConflict(seen, input, index, departmentNumber, source);
    const name = (row[DEPARTMENT.name] ?? "").trim();
    const address = [row[DEPARTMENT.addressLine1], row[DEPARTMENT.addressLine2]]
      .map((part) => (part ?? "").trim())
      .filter((part) => part !== "")
      .join(", ");
    // Phone/fax are not columns of public.agency; buildAgencyPhoneNumbers
    // emits them.
    const candidate = AgencySpec.safeParse({
      name,
      state: (row[DEPARTMENT.state] ?? "").trim(),
      city: nullIfBlank(row[DEPARTMENT.city]),
      address: address === "" ? null : address,
      zip_code: nullIfBlank(row[DEPARTMENT.zip]),
      contact_name: nullIfBlank(row[DEPARTMENT.headName]),
      contact_email: nullIfBlank(row[DEPARTMENT.email]),
      status: nullIfBlank(row[DEPARTMENT.status]),
      status_date: nullIfBlank(toDate(input, index, DEPARTMENT.statusDate)),
    });
    if (!candidate.success) {
      log.info(
        `tcole: omitted invalid agency ${departmentNumber}: ${candidate.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
      );
      if (!leftOut.has(departmentNumber)) {
        const unusable = [
          ...new Set(candidate.error.issues.map((issue) => issue.path[0])),
        ].map((field) => {
          const words = AGENCY_FIELD_WORDS[String(field)];
          if (words === undefined) {
            throw new Error(
              `${SOURCE}: ${input.sheet} row ${rowNumber(index)} fails the agency schema at an unexpected field: ${String(field)}`,
            );
          }
          return words;
        });
        leftOut.set(
          departmentNumber,
          finding(input, index, {
            code: "department-not-buildable",
            field: "agencies",
            value: source,
            message: `Department ${departmentNumber}${name === "" ? "" : ` (${name})`} is in the commission's records but is not listed here because its ${new Intl.ListFormat("en", { type: "conjunction" }).format(unusable)} ${unusable.length === 1 ? "is" : "are"} missing or not usable. Service at this department is not listed either.`,
            source_record_id: departmentNumber,
          }),
        );
      }
      input.accounting.reported += 1;
      continue;
    }
    records[departmentNumber] = { spec: candidate.data };
    input.accounting.emitted += 1;
  }
  return records;
}

function buildAgencyPersonnel(
  input: Input,
  agencies: EmittedRecords,
  personnel: EmittedRecords,
  leftOutDepartments: LeftOut,
  leftOutOfficers: LeftOut,
  leftOut: LeftOut,
): EmittedRecords {
  const records: EmittedRecords = {};
  const seen = new Map<string, string>();
  for (const [index, row] of input.rows.entries()) {
    const publicGuid = (row[SERVICE.publicGuid] ?? "").trim();
    const departmentNumber = (row[SERVICE.departmentNumber] ?? "").trim();
    const appointment = (row[SERVICE.appointment] ?? "").trim();
    const license = (row[SERVICE.license] ?? "").trim();
    const startDate = toDate(input, index, SERVICE.startDate);
    const endDate = toDate(input, index, SERVICE.endDate);

    assertKnown(
      input,
      index,
      SERVICE.departmentNumber,
      departmentNumber,
      "Departments",
      agencies,
      leftOutDepartments,
    );
    assertKnown(
      input,
      index,
      SERVICE.publicGuid,
      publicGuid,
      "Officers",
      personnel,
      leftOutOfficers,
    );
    if (
      agencies[departmentNumber] === undefined ||
      personnel[publicGuid] === undefined
    ) {
      input.accounting.reported += 1;
      continue;
    }

    // Synthetic identity key — matches the prior identity map's `id_field`
    // byte-for-byte (empty segment when a field is blank) so seed IDs are
    // preserved: PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE.
    // Role/license text uses normalized whitespace; a blank role stays blank.
    // The APPOINTMENT segment is used here even when blank — the "Unknown"
    // fallback applies to the `title` value only, never to the key.
    const key = [
      publicGuid,
      departmentNumber,
      normalizeTextWhitespace(appointment),
      normalizeTextWhitespace(license),
      startDate,
      endDate,
    ].join("|");

    // AgencyPersonnel requires a start date (NOT NULL, no sentinel).
    if (startDate === "") {
      const source = readColumns(row, SERVICE);
      assertNoConflict(seen, input, index, key, source);
      if (!leftOut.has(key)) {
        leftOut.set(
          key,
          finding(input, index, {
            code: "service-not-buildable",
            field: "agency_personnel",
            value: source,
            message: `A period of service of officer ${publicGuid} at department ${departmentNumber} is in the commission's records but is not listed here because it has no start date.`,
            source_record_id: key,
          }),
        );
      }
      input.accounting.reported += 1;
      continue;
    }

    const spec = {
      agency_id: departmentNumber,
      personnel_id: publicGuid,
      start_date: startDate,
      end_date: endDate === "" ? null : endDate,
      title: appointment === "" ? "Unknown" : appointment,
      license_id: licenseHoldingKey(publicGuid, license),
    };
    assertNoConflict(seen, input, index, key, spec);
    records[key] ??= {
      metadata: {
        defects:
          appointment === ""
            ? [
                finding(input, index, {
                  code: "blank-appointment",
                  field: "title",
                  value: appointment,
                  message:
                    "The commission's records give no role for this period of service, so the role is shown as Unknown.",
                  source_record_id: key,
                }),
              ]
            : [],
      },
      spec,
    };
    input.accounting.emitted += 1;
  }
  return records;
}

/**
 * Emits the single licensing authority this source has data for: TCOLE. Per ADR
 * 0015 a source emits only its own authorities, using namespace-local names —
 * there is no shared/curated authority dataset. `location_path_id` is the
 * namespace-local state value (`"tx"`); the intake root maps it to the canonical
 * TX location_path (resolve-or-fail, ADR 0006). The source never sees a
 * canonical id. `defects` holds one finding per left-out row and is emitted
 * empty so an earlier finding is resolved (ADR 0040).
 */
function buildLicensingAuthorities(defects: Finding[]): EmittedRecords {
  return {
    tcole: {
      metadata: { defects },
      spec: {
        name: "Texas Commission on Law Enforcement",
        abbreviation: "TCOLE",
        source_namespaces: [SOURCE],
        website: "https://www.tcole.texas.gov",
        location_path_id: "tx",
      },
    },
  };
}

/**
 * One AuthorityLicense per distinct license type TCOLE issues, keyed and named by
 * its canonical (licensing_authority_id, name) — so spelling/suffix variants of a
 * type converge on one row.
 */
function buildAuthorityLicenses(
  serviceRows: Row[],
  licenseActionRows: Row[],
  personnel: EmittedRecords,
): EmittedRecords {
  const records: EmittedRecords = {};
  for (const row of [...licenseActionRows, ...serviceRows]) {
    const publicGuid = (row[ACTION.publicGuid] ?? "").trim();
    const license = (row[ACTION.license] ?? "").trim();
    if (personnel[publicGuid] === undefined) continue;
    const key = authorityLicenseKey(license);
    if (records[key] !== undefined) continue;
    records[key] = {
      spec: {
        licensing_authority_id: TCOLE_AUTHORITY,
        name: canonicalLicenseType(license),
      },
    };
  }
  return records;
}

/**
 * One License (an officer's holding of an authority_license) per distinct
 * PUBLIC_GUID×license type seen in the actions history or the Services roster, for
 * emitted officers. `first_awarded` is the authoritative `DATE_AWARDED`; `status`
 * is the `LICENSE_STATUS` at the latest ACTION_DATE (its current standing); both
 * null for a license seen only in the roster.
 */
function buildLicenses(
  serviceRows: Row[],
  actions: Input,
  personnel: EmittedRecords,
): EmittedRecords {
  // Per holding, in one pass over the action history: the award date and the
  // current status (LICENSE_STATUS at the latest ACTION_DATE; a later row wins).
  const awardDate = new Map<string, string>();
  const latestActionDate = new Map<string, string>();
  const currentStatus = new Map<string, string>();
  for (const [index, row] of actions.rows.entries()) {
    const publicGuid = (row[ACTION.publicGuid] ?? "").trim();
    const license = (row[ACTION.license] ?? "").trim();
    const key = licenseHoldingKey(publicGuid, license);

    const dateAwarded = toDate(actions, index, ACTION.dateAwarded);
    if (dateAwarded !== "" && !awardDate.has(key))
      awardDate.set(key, dateAwarded);

    const actionDate = toDate(actions, index, ACTION.actionDate);
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
  for (const row of [...actions.rows, ...serviceRows]) {
    const publicGuid = (row[ACTION.publicGuid] ?? "").trim();
    const license = (row[ACTION.license] ?? "").trim();
    if (personnel[publicGuid] === undefined) continue;

    const key = licenseHoldingKey(publicGuid, license);
    if (records[key] !== undefined) continue;

    records[key] = {
      spec: {
        personnel_id: publicGuid,
        authority_license_id: authorityLicenseKey(license),
        status: currentStatus.get(key) ?? null,
        first_awarded: awardDate.get(key) ?? null,
      },
    };
  }
  return records;
}

/**
 * Emits one LicenseAction per OfficersLicensesActions row whose officer was
 * emitted, keyed `PUBLIC_GUID|<canonical license type>|LICENSE_ACTION|ACTION_DATE`.
 * `license_id` references the emitted License by its
 * `PUBLIC_GUID|<canonical license type>` key.
 */
function buildLicenseActions(
  input: Input,
  personnel: EmittedRecords,
  leftOutOfficers: LeftOut,
): EmittedRecords {
  const records: EmittedRecords = {};
  const seen = new Map<string, string>();
  for (const [index, row] of input.rows.entries()) {
    const publicGuid = (row[ACTION.publicGuid] ?? "").trim();
    const license = (row[ACTION.license] ?? "").trim();
    const action = (row[ACTION.action] ?? "").trim();
    const actionDate = toDate(input, index, ACTION.actionDate);
    const status = (row[ACTION.status] ?? "").trim();

    assertKnown(
      input,
      index,
      ACTION.publicGuid,
      publicGuid,
      "Officers",
      personnel,
      leftOutOfficers,
    );
    if (personnel[publicGuid] === undefined) {
      input.accounting.reported += 1;
      continue;
    }
    const licenseKey = licenseHoldingKey(publicGuid, license);

    const key = `${licenseKey}|${action}|${actionDate}`;
    const spec = {
      license_id: licenseKey,
      action,
      action_date: actionDate === "" ? null : actionDate,
      status: status === "" ? null : status,
    };
    assertNoConflict(seen, input, index, key, spec);
    records[key] ??= { spec };
    input.accounting.emitted += 1;
  }
  return records;
}
