import { describe, it, expect } from "vitest";
import { transform } from "../../sources/gov.tx.tcole/transform.js";
import {
  AgencySpec,
  PersonnelSpec,
  AgencyPersonnelSpec,
  LicensingAuthoritySpec,
  LicenseSpec,
  LicenseActionSpec,
  AgencyPhoneNumberSpec,
} from "../../src/shared/io/index.js";
// AuthorityLicense is not yet re-exported from the io barrel (see report).
import { AuthorityLicenseSpec } from "../../src/shared/io/generated/entity-specs.js";

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
      STATE: "TX",
      CITY: "Dallas",
      ADD_LINE1: "100 Main St",
      ZIP_CODE: "75201",
      HEAD_NAME: "Jane Doe",
      E_MAIL: "",
      PHONE: "",
    },
    // INACTIVE status does not prevent candidate emission.
    {
      DEPARTMENT_NUMBER: "555555",
      DEPARTMENT_NAME: "Defunct Marshal Office",
      STATUS: "INACTIVE",
      STATE: "TX",
      CITY: "Nowhere",
      ADD_LINE1: "1 Old Rd",
      ZIP_CODE: "70000",
      PHONE: "(512) 555-5555",
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
      LICENSE: "",
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

describe("gov.tx.tcole run", () => {
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
    });
    // second agency: empty email/phone become null/absent
    expect(records["201217"].spec).toMatchObject({
      contact_email: null,
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
      "1000038|471100|||2020-01-01|",
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
    const unknown = records["1000038|471100|||2020-01-01|"];
    expect(unknown).toBeDefined();
    expect(unknown.spec).toEqual({
      agency_id: "471100",
      personnel_id: "1000038",
      start_date: "2020-01-01",
      end_date: null,
      title: "Unknown",
      license_id: null,
    });
    // the "Unknown" fallback is the column value only — never in the key
    expect(Object.keys(records)).not.toContain(
      "1000038|471100|Unknown||2020-01-01|",
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

  it("links AgencyPersonnel to its License, or null when LICENSE is blank", async () => {
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
    // blank-LICENSE assignment -> null (no dangling ref)
    expect(
      (records["1000038|471100|||2020-01-01|"].spec as Record<string, unknown>)
        .license_id,
    ).toBeNull();
  });

  it("is deterministic", async () => {
    expect(await transform(deps)).toEqual(await transform(deps));
  });
});
