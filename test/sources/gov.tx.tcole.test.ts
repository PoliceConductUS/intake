import { describe, it, expect } from "vitest";
import { run } from "../../sources/gov.tx.tcole/config.js";
import {
  AgencySpec,
  PersonnelSpec,
  AgencyPersonnelSpec,
} from "../../src/shared/io/index.js";

const sheets: Record<string, Array<Record<string, string>>> = {
  Officers: [
    { PUBLIC_GUID: "1000033", FNAME: "Scott", MNAME: "D", LNAME: "Garner", SFX: "" },
    { PUBLIC_GUID: "1000038", FNAME: "Marc", MNAME: "", LNAME: "Denney", SFX: "Jr" },
    // only attached to an INACTIVE agency -> dropped by the active cascade
    { PUBLIC_GUID: "2000001", FNAME: "Gone", MNAME: "", LNAME: "Defunct", SFX: "" },
    // not attached to any agency -> dropped by the active cascade
    { PUBLIC_GUID: "3000001", FNAME: "Un", MNAME: "", LNAME: "Attached", SFX: "" },
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
      FAX: "",
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
    // INACTIVE -> not emitted as an agency
    {
      DEPARTMENT_NUMBER: "555555",
      DEPARTMENT_NAME: "Defunct Marshal Office",
      STATUS: "INACTIVE",
      STATE: "TX",
      CITY: "Nowhere",
      ADD_LINE1: "1 Old Rd",
      ZIP_CODE: "70000",
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
    // officer 2000001 only served at the INACTIVE agency 555555 -> both the
    // service and the officer are dropped by the active cascade
    {
      PUBLIC_GUID: "2000001",
      DEPARTMENT_NUMBER: "555555",
      APPOINTMENT: "Jailer",
      LICENSE: "Jailer License",
      ST_DATE: "2010-01-01T00:00:00.000Z",
      END_DATE: "",
    },
  ],
};

const fakeReadXlsx = async (_path: string, sheet?: string) =>
  sheets[sheet ?? ""] ?? [];
const fakeEmit = async () => {};

const deps = {
  paths: ["PublicInformationRequest_2025-02-10_1410.xlsx"],
  readXlsx: fakeReadXlsx,
  state: "/state",
  emit: fakeEmit,
};

describe("gov.tx.tcole run", () => {
  it("emits Agencies, Personnel, and AgencyPersonnel", async () => {
    const manifest = await run(deps);
    expect(manifest.artifacts.map((a) => a.kind)).toEqual([
      "Agencies",
      "Personnel",
      "AgencyPersonnel",
    ]);
  });

  it("maps Officers to valid Personnel keyed by PUBLIC_GUID, skipping nameless rows", async () => {
    const { records } = (await run(deps)).artifacts.find(
      (a) => a.kind === "Personnel",
    )!;
    expect(Object.keys(records).sort()).toEqual(["1000033", "1000038"]);
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
    const { records } = (await run(deps)).artifacts.find(
      (a) => a.kind === "Agencies",
    )!;
    expect(Object.keys(records).sort()).toEqual(["201217", "471100"]);
    expect(records["471100"].spec).toEqual({
      name: "Example County Jail",
      state: "TX",
      city: "Austin",
      address: "1400 West 6th St",
      zip_code: "78703",
      contact_name: "Robert Carroll",
      contact_email: "chief@example.tx",
      phones: { main: "(512) 772-2442" },
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

  it("drops inactive agencies and personnel only attached to them (active cascade)", async () => {
    const manifest = await run(deps);
    const agencies = manifest.artifacts.find((a) => a.kind === "Agencies")!;
    const personnel = manifest.artifacts.find((a) => a.kind === "Personnel")!;
    // 555555 is INACTIVE -> not emitted
    expect(Object.keys(agencies.records)).not.toContain("555555");
    // 2000001 only served the inactive agency; 3000001 has no service -> dropped
    expect(Object.keys(personnel.records)).not.toContain("2000001");
    expect(Object.keys(personnel.records)).not.toContain("3000001");
    expect(Object.keys(personnel.records).sort()).toEqual(["1000033", "1000038"]);
  });

  it("keys AgencyPersonnel by the identity tuple with license_type=APPOINTMENT", async () => {
    const { records } = (await run(deps)).artifacts.find(
      (a) => a.kind === "AgencyPersonnel",
    )!;
    // the inactive-agency (555555) service is dropped by the active cascade
    expect(Object.keys(records).sort()).toEqual([
      "1000033|471100|Jailer|Temporary Jailer License|2024-10-15|",
      "1000038|201217|Peace Officer|Peace Officer License|1994-06-16|2023-09-30",
    ]);
    const open =
      records["1000033|471100|Jailer|Temporary Jailer License|2024-10-15|"]
        .spec;
    expect(open).toEqual({
      agency_id: "471100",
      personnel_id: "1000033",
      start_date: "2024-10-15",
      end_date: null,
      license_type: "Jailer",
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

  it("is deterministic", async () => {
    expect(await run(deps)).toEqual(await run(deps));
  });
});
