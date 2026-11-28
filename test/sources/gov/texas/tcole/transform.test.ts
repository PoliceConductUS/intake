import { buildArtifactsEnvelope } from "../../../../../src/cli/transform/source-transform.js";
import { describe, it, expect } from "vitest";
import { transform } from "../../../../../sources/gov/texas/tcole/transform.js";
import {
  AgencySpec,
  PersonnelSpec,
  AgencyPersonnelSpec,
  LicensingAuthoritySpec,
  LicenseSpec,
  LicenseActionSpec,
  AgencyPhoneNumberSpec,
} from "../../../../../src/shared/io/index.js";
// AuthorityLicense is not yet re-exported from the io barrel (see report).
import { AuthorityLicenseSpec } from "../../../../../src/shared/io/entity-specs.js";

const sheets: Record<string, Array<Record<string, string>>> = {
  Officers: [
    {
      PUBLIC_GUID: "1000033",
      FNAME: "Scott",
      MNAME: "D",
      LNAME: "Garner",
      SFX: "",
    },
    {
      PUBLIC_GUID: "1000038",
      FNAME: "Marc",
      MNAME: "",
      LNAME: "Denney",
      SFX: "Jr",
    },
    // Only attached to an INACTIVE agency; retained as a candidate.
    {
      PUBLIC_GUID: "2000001",
      FNAME: "Gone",
      MNAME: "",
      LNAME: "Defunct",
      SFX: "",
    },
    // Not attached to any agency; retained as a candidate.
    {
      PUBLIC_GUID: "3000001",
      FNAME: "Un",
      MNAME: "",
      LNAME: "Attached",
      SFX: "",
    },
  ],
  Departments: [
    {
      DEPARTMENT_NUMBER: "471100",
      DEPARTMENT_NAME: "Example County Jail",
      STATUS: "ACTIVE",
      DATE_OFFICIAL: "2005-03-14T00:00:00.000Z",
      STATE: "TX",
      CITY: "Austin",
      ADD_LINE1: "1400 West 6th St",
      ADD_LINE2: "",
      ZIP_CODE: "78703",
      HEAD_NAME: "Robert Carroll",
      E_MAIL: "chief@example.tx",
      PHONE: "(512) 772-2442",
      FAX: "(512) 999-0000",
    },
    {
      DEPARTMENT_NUMBER: "201217",
      DEPARTMENT_NAME: "Example Police Dept",
      STATUS: "ACTIVE",
      DATE_OFFICIAL: "",
      STATE: "TX",
      CITY: "Dallas",
      ADD_LINE1: "100 Main St",
      ADD_LINE2: "",
      ZIP_CODE: "75201",
      HEAD_NAME: "Jane Doe",
      E_MAIL: "",
      PHONE: "",
      FAX: "",
    },
    // INACTIVE status does not prevent candidate emission.
    {
      DEPARTMENT_NUMBER: "555555",
      DEPARTMENT_NAME: "Defunct Marshal Office",
      STATUS: "INACTIVE",
      DATE_OFFICIAL: "",
      STATE: "TX",
      CITY: "Nowhere",
      ADD_LINE1: "1 Old Rd",
      ADD_LINE2: "",
      ZIP_CODE: "70000",
      HEAD_NAME: "",
      E_MAIL: "",
      PHONE: "(512) 555-5555",
      FAX: "",
    },
  ],
  Services: [
    // open-ended (null end date) -> trailing-empty segment
    {
      PUBLIC_GUID: "1000033",
      DEPARTMENT_NUMBER: "471100",
      APPOINTMENT: "Jailer",
      LICENSE: "Temporary Jailer License",
      ST_DATE: "2024-10-15T00:00:00.000Z",
      END_DATE: "",
    },
    // closed period
    {
      PUBLIC_GUID: "1000038",
      DEPARTMENT_NUMBER: "201217",
      APPOINTMENT: "Peace Officer",
      LICENSE: "Peace Officer License",
      ST_DATE: "1994-06-16T00:00:00.000Z",
      END_DATE: "2023-09-30T00:00:00.000Z",
    },
    // Officer 2000001 has an open assignment at an INACTIVE agency.
    {
      PUBLIC_GUID: "2000001",
      DEPARTMENT_NUMBER: "555555",
      APPOINTMENT: "Jailer",
      LICENSE: "Jailer License",
      ST_DATE: "2010-01-01T00:00:00.000Z",
      END_DATE: "",
    },
    // blank APPOINTMENT -> retained with title "Unknown"; the key keeps the
    // empty APPOINTMENT segment so it stays byte-compatible with the map
    {
      PUBLIC_GUID: "1000038",
      DEPARTMENT_NUMBER: "471100",
      APPOINTMENT: "",
      LICENSE: "Peace Officer License",
      ST_DATE: "2020-01-01T00:00:00.000Z",
      END_DATE: "",
    },
  ],
  // Real column names: LICENSE_ACTION (the action), LICENSE_STATUS (ACTIVE/
  // INACTIVE after that action), DATE_AWARDED (the license's award date, constant
  // per license). DATE_AWARDED is deliberately set earlier than the earliest
  // ACTION_DATE so `first_awarded` (DATE_AWARDED) is distinguishable from the old
  // earliest-ACTION_DATE behavior, and status changes over time so "latest action
  // wins" is actually exercised.
  OfficersLicensesActions: [
    // 1000038's Peace Officer License: two actions, both ACTIVE.
    {
      PUBLIC_GUID: "1000038",
      LICENSE: "Peace Officer License",
      DATE_AWARDED: "1994-06-16T00:00:00.000Z",
      ACTION_DATE: "1994-06-16T00:00:00.000Z",
      LICENSE_ACTION: "Granted",
      LICENSE_STATUS: "ACTIVE",
    },
    {
      PUBLIC_GUID: "1000038",
      LICENSE: "Peace Officer License",
      DATE_AWARDED: "1994-06-16T00:00:00.000Z",
      ACTION_DATE: "2000-01-01T00:00:00.000Z",
      LICENSE_ACTION: "Renewed",
      LICENSE_STATUS: "ACTIVE",
    },
    // 1000033's Temporary Jailer License: awarded 2019-12-01 (before the earliest
    // action 2020-01-01), then suspended -> current status INACTIVE.
    {
      PUBLIC_GUID: "1000033",
      LICENSE: "Temporary Jailer License",
      DATE_AWARDED: "2019-12-01T00:00:00.000Z",
      ACTION_DATE: "2020-01-01T00:00:00.000Z",
      LICENSE_ACTION: "Granted",
      LICENSE_STATUS: "ACTIVE",
    },
    {
      PUBLIC_GUID: "1000033",
      LICENSE: "Temporary Jailer License",
      DATE_AWARDED: "2019-12-01T00:00:00.000Z",
      ACTION_DATE: "2024-10-15T00:00:00.000Z",
      LICENSE_ACTION: "Suspended",
      LICENSE_STATUS: "INACTIVE",
    },
    // Action for the officer attached only to an INACTIVE agency.
    {
      PUBLIC_GUID: "2000001",
      LICENSE: "Jailer License",
      DATE_AWARDED: "2010-01-01T00:00:00.000Z",
      ACTION_DATE: "2010-01-01T00:00:00.000Z",
      LICENSE_ACTION: "Granted",
      LICENSE_STATUS: "ACTIVE",
    },
  ],
};

// Mirror the real readXlsx guard: a declared-but-missing column fails loud, so a
// fixture that drops a column the source reads breaks the test instead of
// silently emptying it.
const fakeReadXlsx = async (
  _path: string,
  sheet?: string,
  requiredColumns?: readonly string[],
) => {
  const rows = sheets[sheet ?? ""] ?? [];
  if (requiredColumns !== undefined && rows[0] !== undefined) {
    const missing = requiredColumns.filter((column) => !(column in rows[0]));
    if (missing.length > 0) {
      throw new Error(
        `fixture sheet "${sheet}" missing column(s): ${missing.join(", ")}`,
      );
    }
  }
  return rows;
};
const fakeEmit = async () => {};

const deps = {
  paths: ["PublicInformationRequest_2025-02-10_1410.xlsx"],
  readXlsx: fakeReadXlsx,
  state: "/state",
  emit: fakeEmit,
};

describe("gov/texas/tcole run", () => {
  it("normalizes role and license whitespace in assignment keys without altering raw evidence", async () => {
    const service = {
      PUBLIC_GUID: "1000038",
      DEPARTMENT_NUMBER: "201217",
      APPOINTMENT: "  Telecommunications   Operator ",
      LICENSE: " Telecommunications  Operator ",
      ST_DATE: "2018-08-16",
      END_DATE: "",
    };
    const result = await transform({
      ...deps,
      readXlsx: async (file, sheet, columns) =>
        sheet === "Services" ? [service] : fakeReadXlsx(file, sheet, columns),
    });
    const assignments = result.artifacts.find(
      (a) => a.kind === "AgencyPersonnel",
    )!.records;
    expect(Object.keys(assignments)).toEqual([
      "1000038|201217|Telecommunications Operator|Telecommunications Operator|2018-08-16|",
    ]);
    expect(service.LICENSE).toBe(" Telecommunications  Operator ");
  });

  it("emits the licensing kinds in dependency order", async () => {
    const manifest = await transform(deps);
    expect(manifest.artifacts.map((a) => a.kind)).toEqual([
      "LicensingAuthorities",
      "AuthorityLicenses",
      "Agencies",
      "Personnel",
      "Licenses",
      "LicenseActions",
      "AgencyPersonnel",
      "AgencyPhoneNumbers",
    ]);
  });

  it("emits one AgencyPhoneNumber per non-blank PHONE/FAX on each candidate agency", async () => {
    const { records } = (await transform(deps)).artifacts.find(
      (a) => a.kind === "AgencyPhoneNumbers",
    )!;
    // Phone records follow emitted agencies regardless of STATUS.
    expect(Object.keys(records).sort()).toEqual([
      "471100|Fax",
      "471100|Phone",
      "555555|Phone",
    ]);
    expect(records["471100|Phone"].spec).toEqual({
      agency_id: "471100",
      phone_number: "(512) 772-2442",
      description: "Phone",
    });
    expect(records["471100|Fax"].spec).toEqual({
      agency_id: "471100",
      phone_number: "(512) 999-0000",
      description: "Fax",
    });
    for (const [, record] of Object.entries(records)) {
      expect(AgencyPhoneNumberSpec.parse(record.spec)).toBeTruthy();
    }
  });

  it("retains personnel candidates at inactive agencies and without assignments", async () => {
    const { records } = (await transform(deps)).artifacts.find(
      (a) => a.kind === "Personnel",
    )!;
    expect(Object.keys(records).sort()).toEqual([
      "1000033",
      "1000038",
      "2000001",
      "3000001",
    ]);
    expect(records["1000033"].spec).toEqual({
      id: "1000033",
      first_name: "Scott",
      last_name: "Garner",
      middle_name: "D",
      suffix: null,
    });
    expect(records["1000038"].spec).toMatchObject({
      middle_name: null,
      suffix: "Jr",
    });
    for (const record of Object.values(records)) {
      expect(PersonnelSpec.safeParse(record.spec).success).toBe(true);
    }
  });

  it("maps Departments to valid Agencies with addresses (no slug/location/lat/lng)", async () => {
    const { records } = (await transform(deps)).artifacts.find(
      (a) => a.kind === "Agencies",
    )!;
    expect(Object.keys(records).sort()).toEqual(["201217", "471100", "555555"]);
    expect(records["471100"].spec).toEqual({
      name: "Example County Jail",
      state: "TX",
      city: "Austin",
      address: "1400 West 6th St",
      zip_code: "78703",
      contact_name: "Robert Carroll",
      contact_email: "chief@example.tx",
      status: "ACTIVE",
      status_date: "2005-03-14",
    });
    // second agency: empty email/phone become null/absent
    expect(records["201217"].spec).toMatchObject({
      contact_email: null,
      status: "ACTIVE",
      status_date: null,
    });
    expect(records["201217"].spec).not.toHaveProperty("phones");
    for (const record of Object.values(records)) {
      const spec = record.spec as Record<string, unknown>;
      expect(spec).not.toHaveProperty("slug");
      expect(spec).not.toHaveProperty("location_path_id");
      expect(spec).not.toHaveProperty("latitude");
      expect(AgencySpec.safeParse(spec).success).toBe(true);
    }
  });

  it("emits an inactive agency with its open assignment for shared selection", async () => {
    const manifest = await transform(deps);
    const agencies = manifest.artifacts.find((a) => a.kind === "Agencies")!;
    const assignments = manifest.artifacts.find(
      (a) => a.kind === "AgencyPersonnel",
    )!;
    expect(agencies.records["555555"].spec).toMatchObject({
      name: "Defunct Marshal Office",
      status: "INACTIVE",
      status_date: null,
    });
    expect(
      assignments.records["2000001|555555|Jailer|Jailer License|2010-01-01|"]
        .spec,
    ).toEqual({
      agency_id: "555555",
      personnel_id: "2000001",
      start_date: "2010-01-01",
      end_date: null,
      title: "Jailer",
      license_id: "2000001|Jailer",
    });
  });

  it("keys AgencyPersonnel by the identity tuple with title=APPOINTMENT", async () => {
    const { records } = (await transform(deps)).artifacts.find(
      (a) => a.kind === "AgencyPersonnel",
    )!;
    // Open and ended assignments remain candidates, including inactive agencies.
    expect(Object.keys(records).sort()).toEqual([
      "1000033|471100|Jailer|Temporary Jailer License|2024-10-15|",
      "1000038|201217|Peace Officer|Peace Officer License|1994-06-16|2023-09-30",
      "1000038|471100||Peace Officer License|2020-01-01|",
      "2000001|555555|Jailer|Jailer License|2010-01-01|",
    ]);
    const open =
      records["1000033|471100|Jailer|Temporary Jailer License|2024-10-15|"]
        .spec;
    expect(open).toEqual({
      agency_id: "471100",
      personnel_id: "1000033",
      start_date: "2024-10-15",
      end_date: null,
      title: "Jailer",
      license_id: "1000033|Temporary Jailer",
    });
    const closed =
      records[
        "1000038|201217|Peace Officer|Peace Officer License|1994-06-16|2023-09-30"
      ].spec;
    expect(closed).toMatchObject({ end_date: "2023-09-30" });
    for (const record of Object.values(records)) {
      expect(AgencyPersonnelSpec.safeParse(record.spec).success).toBe(true);
    }
  });

  it("retains a blank APPOINTMENT as title 'Unknown', keeping the empty key segment", async () => {
    const { records } = (await transform(deps)).artifacts.find(
      (a) => a.kind === "AgencyPersonnel",
    )!;
    const unknown =
      records["1000038|471100||Peace Officer License|2020-01-01|"];
    expect(unknown).toBeDefined();
    expect(unknown.spec).toEqual({
      agency_id: "471100",
      personnel_id: "1000038",
      start_date: "2020-01-01",
      end_date: null,
      title: "Unknown",
      license_id: "1000038|Peace Officer",
    });
    // the "Unknown" fallback is the column value only — never in the key
    expect(Object.keys(records)).not.toContain(
      "1000038|471100|Unknown|Peace Officer License|2020-01-01|",
    );
    expect(AgencyPersonnelSpec.safeParse(unknown.spec).success).toBe(true);
  });

  it("emits a valid TCOLE LicensingAuthority with the namespace-local state value", async () => {
    const { records } = (await transform(deps)).artifacts.find(
      (a) => a.kind === "LicensingAuthorities",
    )!;
    expect(records["tcole"].spec).toEqual({
      name: "Texas Commission on Law Enforcement",
      abbreviation: "TCOLE",
      source_namespaces: ["gov/texas/tcole"],
      website: "https://www.tcole.texas.gov",
      location_path_id: "tx",
    });
    for (const record of Object.values(records)) {
      expect(LicensingAuthoritySpec.safeParse(record.spec).success).toBe(true);
    }
  });

  it("emits AuthorityLicenses keyed by authority|canonical-name", async () => {
    const { records } = (await transform(deps)).artifacts.find(
      (a) => a.kind === "AuthorityLicenses",
    )!;
    // one per distinct license type held by an emitted officer, canonicalized
    // (the trailing " License" dropped) so spelling variants converge
    expect(Object.keys(records).sort()).toEqual([
      "tcole|Jailer",
      "tcole|Peace Officer",
      "tcole|Temporary Jailer",
    ]);
    expect(records["tcole|Peace Officer"].spec).toEqual({
      licensing_authority_id: "tcole",
      name: "Peace Officer",
    });
    for (const record of Object.values(records)) {
      expect(AuthorityLicenseSpec.safeParse(record.spec).success).toBe(true);
    }
  });

  it("emits Licenses (holdings) keyed by PUBLIC_GUID|canonical-type", async () => {
    const { records } = (await transform(deps)).artifacts.find(
      (a) => a.kind === "Licenses",
    )!;
    // Licenses follow emitted personnel candidates with a non-blank LICENSE.
    expect(Object.keys(records).sort()).toEqual([
      "1000033|Temporary Jailer",
      "1000038|Peace Officer",
      "2000001|Jailer",
    ]);
    expect(records["1000038|Peace Officer"].spec).toEqual({
      personnel_id: "1000038",
      authority_license_id: "tcole|Peace Officer",
      // current status = LICENSE_STATUS of the latest action (2000-01-01 Renewed)
      status: "ACTIVE",
      // authoritative DATE_AWARDED, not the earliest ACTION_DATE
      first_awarded: "1994-06-16",
    });
    // 1000033's license was awarded 2019-12-01 (before its earliest action
    // 2020-01-01) and later Suspended -> current status INACTIVE.
    expect(records["1000033|Temporary Jailer"].spec).toEqual({
      personnel_id: "1000033",
      authority_license_id: "tcole|Temporary Jailer",
      status: "INACTIVE",
      first_awarded: "2019-12-01",
    });
    for (const record of Object.values(records)) {
      expect(LicenseSpec.safeParse(record.spec).success).toBe(true);
    }
  });

  it("emits candidate LicenseActions keyed by the 4-tuple", async () => {
    const { records } = (await transform(deps)).artifacts.find(
      (a) => a.kind === "LicenseActions",
    )!;
    expect(Object.keys(records).sort()).toEqual([
      "1000033|Temporary Jailer|Granted|2020-01-01",
      "1000033|Temporary Jailer|Suspended|2024-10-15",
      "1000038|Peace Officer|Granted|1994-06-16",
      "1000038|Peace Officer|Renewed|2000-01-01",
      "2000001|Jailer|Granted|2010-01-01",
    ]);
    expect(records["1000038|Peace Officer|Granted|1994-06-16"].spec).toEqual({
      license_id: "1000038|Peace Officer",
      action: "Granted",
      action_date: "1994-06-16",
      status: "ACTIVE",
    });
    // a disciplinary action is preserved verbatim, with its resulting status
    expect(
      records["1000033|Temporary Jailer|Suspended|2024-10-15"].spec,
    ).toEqual({
      license_id: "1000033|Temporary Jailer",
      action: "Suspended",
      action_date: "2024-10-15",
      status: "INACTIVE",
    });
    for (const record of Object.values(records)) {
      expect(LicenseActionSpec.safeParse(record.spec).success).toBe(true);
    }
  });

  it("links AgencyPersonnel to its License", async () => {
    const { records } = (await transform(deps)).artifacts.find(
      (a) => a.kind === "AgencyPersonnel",
    )!;
    // licensed assignment -> license_id points at the emitted License holding key
    expect(
      (
        records[
          "1000038|201217|Peace Officer|Peace Officer License|1994-06-16|2023-09-30"
        ].spec as Record<string, unknown>
      ).license_id,
    ).toBe("1000038|Peace Officer");
  });

  it("is deterministic", async () => {
    expect(await transform(deps)).toEqual(await transform(deps));
  });
});

it.each([
  ["CITY", ""],
  ["ADD_LINE1", ""],
  ["ZIP_CODE", ""],
  ["CITY", " x "],
  ["ADD_LINE1", " NuLl "],
  ["ZIP_CODE", "00000-0000"],
])(
  "omits an agency with invalid %s=%s and its dependent records without changing raw input",
  async (field, value) => {
    const departments = sheets.Departments!.map((row) =>
      row.DEPARTMENT_NUMBER === "555555" ? { ...row, [field]: value } : row,
    );
    const messages: string[] = [];
    const manifest = await transform({
      ...deps,
      logger: { info: (message: string) => messages.push(message) },
      readXlsx: async (file, sheet, columns) =>
        sheet === "Departments"
          ? departments
          : fakeReadXlsx(file, sheet, columns),
    });
    expect(() =>
      buildArtifactsEnvelope("gov/texas/tcole", "invalid-address", manifest),
    ).not.toThrow();
    const agencies = manifest.artifacts.find(
      (artifact) => artifact.kind === "Agencies",
    )!.records;
    expect(Object.keys(agencies).sort()).toEqual(["201217", "471100"]);
    for (const kind of ["AgencyPersonnel", "AgencyPhoneNumbers"]) {
      const records = manifest.artifacts.find(
        (artifact) => artifact.kind === kind,
      )!.records;
      for (const record of Object.values(records)) {
        expect(record).not.toMatchObject({ spec: { agency_id: "555555" } });
      }
    }
    expect(messages.join("\n")).toContain("omitted invalid agency 555555");
    expect(departments[2]![field]).toBe(value);
  },
);

it("preserves suspect names and suffixes for shared validation and explicit exclusion data", async () => {
  const raw = [
    {
      PUBLIC_GUID: "fixture",
      FNAME: "User",
      LNAME: "Test",
      MNAME: "",
      SFX: "",
    },
    {
      PUBLIC_GUID: "numeric",
      FNAME: "9",
      LNAME: "Townsend",
      MNAME: "",
      SFX: "111",
    },
    {
      PUBLIC_GUID: "real",
      FNAME: "Foo",
      LNAME: "Tester",
      MNAME: "",
      SFX: "N/A",
    },
  ];
  const result = await transform({
    ...deps,
    readXlsx: async (file, sheet, columns) =>
      sheet === "Officers"
        ? raw
        : sheet === "Departments"
          ? fakeReadXlsx(file, sheet, columns)
          : [],
  });
  const records = result.artifacts.find((a) => a.kind === "Personnel")!.records;
  expect(Object.keys(records)).toEqual(["fixture", "numeric", "real"]);
  expect(records.numeric.spec).toMatchObject({
    first_name: "9",
    suffix: "111",
  });
  expect(records.real.spec).toMatchObject({ first_name: "Foo", suffix: "N/A" });
});

const withSheet =
  (name: string, rows: Array<Record<string, string>>) =>
  async (file: string, sheet?: string, columns?: readonly string[]) =>
    sheet === name ? rows : fakeReadXlsx(file, sheet, columns);

const editRow = (
  sheet: string,
  index: number,
  change: Record<string, string>,
) =>
  withSheet(
    sheet,
    sheets[sheet]!.map((row, at) =>
      at === index ? { ...row, ...change } : row,
    ),
  );

const records = (
  manifest: Awaited<ReturnType<typeof transform>>,
  kind: string,
) => manifest.artifacts.find((artifact) => artifact.kind === kind)!.records;

const WORKBOOK = "PublicInformationRequest_2025-02-10_1410.xlsx";

describe("gov/texas/tcole left-out rows", () => {
  it("accounts for every row of each sheet when nothing is left out", async () => {
    const manifest = await transform(deps);
    expect(manifest.accounting).toEqual([
      {
        input: "Departments",
        read: 3,
        emitted: 3,
        reported: 0,
        notSelected: {},
      },
      { input: "Officers", read: 4, emitted: 4, reported: 0, notSelected: {} },
      { input: "Services", read: 4, emitted: 4, reported: 0, notSelected: {} },
      {
        input: "OfficersLicensesActions",
        read: 5,
        emitted: 5,
        reported: 0,
        notSelected: {},
      },
    ]);
    expect(records(manifest, "LicensingAuthorities").tcole.metadata).toEqual({
      defects: [],
    });
  });

  it.each([
    ["Departments", 1, "DEPARTMENT_NUMBER", 3],
    ["Officers", 0, "PUBLIC_GUID", 2],
    ["Services", 2, "PUBLIC_GUID", 4],
    ["Services", 0, "DEPARTMENT_NUMBER", 2],
    ["Services", 1, "LICENSE", 3],
    ["OfficersLicensesActions", 4, "PUBLIC_GUID", 6],
    ["OfficersLicensesActions", 0, "LICENSE", 2],
    ["OfficersLicensesActions", 3, "LICENSE_ACTION", 5],
  ])(
    "throws for %s row index %i with a blank %s",
    async (sheet, index, column, rowNumber) => {
      await expect(
        transform({
          ...deps,
          readXlsx: editRow(sheet, index, { [column]: " " }),
        }),
      ).rejects.toThrow(
        `gov/texas/tcole: ${sheet} row ${rowNumber} has a blank ${column}.`,
      );
    },
  );

  it.each([
    [
      "Departments",
      { ...sheets.Departments![0]!, CITY: "Elsewhere" },
      "471100",
    ],
    [
      "Departments",
      { ...sheets.Departments![0]!, FAX: "(512) 111-1111" },
      "471100",
    ],
    ["Officers", { ...sheets.Officers![0]!, LNAME: "Gardner" }, "1000033"],
    [
      "Services",
      { ...sheets.Services![1]!, APPOINTMENT: "Peace  Officer" },
      "1000038|201217|Peace Officer|Peace Officer License|1994-06-16|2023-09-30",
    ],
    [
      "OfficersLicensesActions",
      { ...sheets.OfficersLicensesActions![0]!, LICENSE_STATUS: "INACTIVE" },
      "1000038|Peace Officer|Granted|1994-06-16",
    ],
  ])(
    "throws naming the key when two %s rows produce one key with different content",
    async (sheet, repeat, key) => {
      const rows = [...sheets[sheet]!, repeat];
      await expect(
        transform({ ...deps, readXlsx: withSheet(sheet, rows) }),
      ).rejects.toThrow(
        `gov/texas/tcole: ${sheet} row ${rows.length + 1} repeats key ${key} with different content.`,
      );
    },
  );

  it("treats identical repeated rows as one record and counts each row", async () => {
    const twice = (rows: Array<Record<string, string>>) => [
      ...rows,
      { ...rows[0]! },
    ];
    const once = await transform(deps);
    const manifest = await transform({
      ...deps,
      readXlsx: async (file, sheet, columns) =>
        twice(await fakeReadXlsx(file, sheet, columns)),
    });
    expect(manifest.artifacts).toEqual(once.artifacts);
    expect(
      manifest.accounting.map(({ input, read, emitted, reported }) => [
        input,
        read,
        emitted,
        reported,
      ]),
    ).toEqual([
      ["Departments", 4, 4, 0],
      ["Officers", 5, 5, 0],
      ["Services", 5, 5, 0],
      ["OfficersLicensesActions", 6, 6, 0],
    ]);
  });

  it("reports a department that fails the agency schema on the TCOLE authority and counts its service rows as reported", async () => {
    const manifest = await transform({
      ...deps,
      readXlsx: editRow("Departments", 2, { ZIP_CODE: "00000-0000" }),
    });
    expect(Object.keys(records(manifest, "Agencies")).sort()).toEqual([
      "201217",
      "471100",
    ]);
    expect(records(manifest, "LicensingAuthorities").tcole.metadata).toEqual({
      defects: [
        {
          code: "department-not-buildable",
          type: "warning",
          field: "agencies",
          value: {
            DEPARTMENT_NUMBER: "555555",
            DEPARTMENT_NAME: "Defunct Marshal Office",
            STATE: "TX",
            STATUS: "INACTIVE",
            DATE_OFFICIAL: "",
            ADD_LINE1: "1 Old Rd",
            ADD_LINE2: "",
            CITY: "Nowhere",
            ZIP_CODE: "00000-0000",
            HEAD_NAME: "",
            E_MAIL: "",
            PHONE: "(512) 555-5555",
            FAX: "",
          },
          message:
            "Department 555555 (Defunct Marshal Office) is in the commission's records but is not listed here because its ZIP code is missing or not usable. Service at this department is not listed either.",
          evidence: [
            {
              workbook: WORKBOOK,
              sheet: "Departments",
              row: 4,
            },
          ],
          source_namespace: "gov/texas/tcole",
          source_record_id: "555555",
        },
      ],
    });
    expect(manifest.accounting).toEqual([
      {
        input: "Departments",
        read: 3,
        emitted: 2,
        reported: 1,
        notSelected: {},
      },
      { input: "Officers", read: 4, emitted: 4, reported: 0, notSelected: {} },
      { input: "Services", read: 4, emitted: 3, reported: 1, notSelected: {} },
      {
        input: "OfficersLicensesActions",
        read: 5,
        emitted: 5,
        reported: 0,
        notSelected: {},
      },
    ]);
    expect(() =>
      buildArtifactsEnvelope("gov/texas/tcole", "left-out", manifest),
    ).not.toThrow();
  });

  it("reports a department with a blank name and no address, naming each unusable value", async () => {
    const manifest = await transform({
      ...deps,
      readXlsx: editRow("Departments", 1, {
        DEPARTMENT_NAME: "",
        ADD_LINE1: "NULL",
      }),
    });
    const defects = records(manifest, "LicensingAuthorities").tcole.metadata!
      .defects!;
    expect(
      defects.map((finding) => [finding.source_record_id, finding.message]),
    ).toEqual([
      [
        "201217",
        "Department 201217 is in the commission's records but is not listed here because its name and address are missing or not usable. Service at this department is not listed either.",
      ],
    ]);
  });

  it("reports one finding for a left-out department that is repeated identically", async () => {
    const bad = { ...sheets.Departments![2]!, CITY: "" };
    const manifest = await transform({
      ...deps,
      readXlsx: withSheet("Departments", [
        sheets.Departments![0]!,
        sheets.Departments![1]!,
        bad,
        { ...bad },
      ]),
    });
    expect(
      records(manifest, "LicensingAuthorities").tcole.metadata!.defects!.map(
        (finding) => finding.source_record_id,
      ),
    ).toEqual(["555555"]);
    expect(manifest.accounting[0]).toEqual({
      input: "Departments",
      read: 4,
      emitted: 2,
      reported: 2,
      notSelected: {},
    });
  });

  it("reports an officer with no first name on the TCOLE authority and counts the officer's other rows as reported", async () => {
    const manifest = await transform({
      ...deps,
      readXlsx: editRow("Officers", 0, { FNAME: "NULL" }),
    });
    expect(Object.keys(records(manifest, "Personnel")).sort()).toEqual([
      "1000038",
      "2000001",
      "3000001",
    ]);
    expect(records(manifest, "LicensingAuthorities").tcole.metadata).toEqual({
      defects: [
        {
          code: "officer-not-buildable",
          type: "warning",
          field: "personnel",
          value: {
            PUBLIC_GUID: "1000033",
            FNAME: "NULL",
            LNAME: "Garner",
            MNAME: "D",
            SFX: "",
          },
          message:
            "Officer record 1000033 is in the commission's records but is not listed here because it has no first name. The officer's licenses and service are not listed either.",
          evidence: [{ workbook: WORKBOOK, sheet: "Officers", row: 2 }],
          source_namespace: "gov/texas/tcole",
          source_record_id: "1000033",
        },
      ],
    });
    expect(Object.keys(records(manifest, "Licenses")).sort()).toEqual([
      "1000038|Peace Officer",
      "2000001|Jailer",
    ]);
    expect(manifest.accounting).toEqual([
      {
        input: "Departments",
        read: 3,
        emitted: 3,
        reported: 0,
        notSelected: {},
      },
      { input: "Officers", read: 4, emitted: 3, reported: 1, notSelected: {} },
      { input: "Services", read: 4, emitted: 3, reported: 1, notSelected: {} },
      {
        input: "OfficersLicensesActions",
        read: 5,
        emitted: 3,
        reported: 2,
        notSelected: {},
      },
    ]);
  });

  it("reports a service row with no start date on the TCOLE authority", async () => {
    const manifest = await transform({
      ...deps,
      readXlsx: editRow("Services", 1, { ST_DATE: "" }),
    });
    expect(Object.keys(records(manifest, "AgencyPersonnel")).sort()).toEqual([
      "1000033|471100|Jailer|Temporary Jailer License|2024-10-15|",
      "1000038|471100||Peace Officer License|2020-01-01|",
      "2000001|555555|Jailer|Jailer License|2010-01-01|",
    ]);
    expect(records(manifest, "LicensingAuthorities").tcole.metadata).toEqual({
      defects: [
        {
          code: "service-not-buildable",
          type: "warning",
          field: "agency_personnel",
          value: {
            PUBLIC_GUID: "1000038",
            DEPARTMENT_NUMBER: "201217",
            APPOINTMENT: "Peace Officer",
            LICENSE: "Peace Officer License",
            ST_DATE: "",
            END_DATE: "2023-09-30T00:00:00.000Z",
          },
          message:
            "A period of service of officer 1000038 at department 201217 is in the commission's records but is not listed here because it has no start date.",
          evidence: [{ workbook: WORKBOOK, sheet: "Services", row: 3 }],
          source_namespace: "gov/texas/tcole",
          source_record_id:
            "1000038|201217|Peace Officer|Peace Officer License||2023-09-30",
        },
      ],
    });
    expect(manifest.accounting[2]).toEqual({
      input: "Services",
      read: 4,
      emitted: 3,
      reported: 1,
      notSelected: {},
    });
  });

  it("emits every assignment with its findings, reporting a blank APPOINTMENT shown as Unknown", async () => {
    const assignments = records(await transform(deps), "AgencyPersonnel");
    expect(
      Object.fromEntries(
        Object.entries(assignments).map(([key, record]) => [
          key,
          record.metadata,
        ]),
      ),
    ).toEqual({
      "1000033|471100|Jailer|Temporary Jailer License|2024-10-15|": {
        defects: [],
      },
      "1000038|201217|Peace Officer|Peace Officer License|1994-06-16|2023-09-30":
        { defects: [] },
      "2000001|555555|Jailer|Jailer License|2010-01-01|": { defects: [] },
      "1000038|471100||Peace Officer License|2020-01-01|": {
        defects: [
          {
            code: "blank-appointment",
            type: "warning",
            field: "title",
            value: "",
            message:
              "The commission's records give no role for this period of service, so the role is shown as Unknown.",
            evidence: [{ workbook: WORKBOOK, sheet: "Services", row: 5 }],
            source_namespace: "gov/texas/tcole",
            source_record_id:
              "1000038|471100||Peace Officer License|2020-01-01|",
          },
        ],
      },
    });
  });

  it.each([
    [
      "Services",
      0,
      { DEPARTMENT_NUMBER: "999999" },
      "gov/texas/tcole: Services row 2 names DEPARTMENT_NUMBER 999999, which is not in the Departments sheet.",
    ],
    [
      "Services",
      3,
      { PUBLIC_GUID: "7777777" },
      "gov/texas/tcole: Services row 5 names PUBLIC_GUID 7777777, which is not in the Officers sheet.",
    ],
    [
      "OfficersLicensesActions",
      1,
      { PUBLIC_GUID: "7777777" },
      "gov/texas/tcole: OfficersLicensesActions row 3 names PUBLIC_GUID 7777777, which is not in the Officers sheet.",
    ],
  ])(
    "throws when a %s row names a department or officer that no row describes",
    async (sheet, index, change, message) => {
      await expect(
        transform({ ...deps, readXlsx: editRow(sheet, index, change) }),
      ).rejects.toThrow(message);
    },
  );

  it.each([
    ["Departments", 0, "DATE_OFFICIAL", 2],
    ["Services", 0, "ST_DATE", 2],
    ["Services", 1, "END_DATE", 3],
    ["OfficersLicensesActions", 2, "DATE_AWARDED", 4],
    ["OfficersLicensesActions", 4, "ACTION_DATE", 6],
  ])(
    "throws for %s row index %i when %s is not a date",
    async (sheet, index, column, rowNumber) => {
      await expect(
        transform({
          ...deps,
          readXlsx: editRow(sheet, index, { [column]: "unknown" }),
        }),
      ).rejects.toThrow(
        `gov/texas/tcole: ${sheet} row ${rowNumber} ${column} is not a date: unknown`,
      );
    },
  );

  it("throws when given more than one workbook", async () => {
    await expect(
      transform({
        ...deps,
        paths: ["/in/a.xlsx", "/in/notes.txt", "/in/b.XLSX"],
      }),
    ).rejects.toThrow(
      "gov/texas/tcole expects a single .xlsx workbook input, got 2: /in/a.xlsx, /in/b.XLSX",
    );
  });
});
