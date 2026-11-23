import { describe, expect, test } from "vitest";
import {
  annotationDisplayValue,
  annotationPage,
} from "../../../src/cli/import/artifacts/facades/annotation-page.js";

// In-memory rows keyed by kind and primary key.
const rows: Record<string, Record<string, Record<string, unknown>>> = {
  Personnel: {
    p1: { id: "p1", slug: "pat-one", first_name: "Pat", last_name: "One" },
  },
  Agency: {
    a1: {
      id: "a1",
      name: "Agency A",
      slug: "agency-a",
      location_path_id: "place",
    },
  },
  LocationPath: {
    state: {
      location_path_id: "state",
      path: "/zz/",
      level: "state",
      display_name: "Zed",
    },
    place: {
      location_path_id: "place",
      path: "/zz/test-county/alpha/",
      level: "place",
      display_name: "Alpha",
    },
  },
  AgencyPersonnel: { ap1: { id: "ap1", agency_id: "a1", personnel_id: "p1" } },
  CivilCase: { c1: { id: "c1", slug: "doe-v-a", title: "Doe v. A" } },
  CivilCasePersonnel: {
    ccp1: { id: "ccp1", civil_case_id: "c1", agency_personnel_id: "ap1" },
  },
  AgencyPhoneNumber: { ph1: { id: "ph1", agency_id: "a1" } },
  LicensingAuthority: {
    la1: { id: "la1", name: "Zed Board", location_path_id: "state" },
  },
  AuthorityLicense: { al1: { id: "al1", licensing_authority_id: "la1" } },
  License: {
    l1: { id: "l1", personnel_id: "p1", authority_license_id: "al1" },
  },
  LicenseAction: { lact1: { id: "lact1", license_id: "l1" } },
  Review: {
    r1: {
      id: "r1",
      slug: "traffic-stop",
      title: "Traffic stop",
      location_path_id: "place",
      incident_date: "2025-03-04T15:00:00Z",
    },
  },
};

async function read(kind: string, id: string) {
  const row = rows[kind]?.[id];
  if (row === undefined) throw new Error(`missing ${kind} ${id}`);
  return row;
}

describe("annotationPage", () => {
  test("a link between a person and a case attaches to the person and links every connected record", async () => {
    expect(await annotationPage("CivilCasePersonnel", "ccp1", read)).toEqual({
      attachment: {
        personnel_id: "p1",
        agency_id: null,
        review_id: null,
        civil_case_id: null,
        location_path_id: null,
        federal_agency_id: null,
        licensing_authority_id: null,
      },
      links: [
        { url: "/personnel/pat-one/", label: "Pat One" },
        { url: "/zz/test-county/alpha/agency-a/", label: "Agency A" },
        { url: "/civil-cases/doe-v-a/", label: "Doe v. A" },
      ],
    });
  });

  test("an assignment links to its section of the person page", async () => {
    expect(
      (await annotationPage("AgencyPersonnel", "ap1", read)).links[0],
    ).toEqual({
      url: "/personnel/pat-one/#agency-assignments",
      label: "Pat One",
    });
  });

  test("a record without a person attaches to its agency", async () => {
    const page = await annotationPage("AgencyPhoneNumber", "ph1", read);
    expect(page.attachment.agency_id).toBe("a1");
    expect(page.links).toEqual([
      { url: "/zz/test-county/alpha/agency-a/", label: "Agency A" },
    ]);
  });

  test("a license action attaches to the person, not the licensing authority", async () => {
    const page = await annotationPage("LicenseAction", "lact1", read);
    expect(page.attachment.personnel_id).toBe("p1");
    expect(page.attachment.licensing_authority_id).toBeNull();
    expect(page.links[1]).toEqual({
      url: "/zz/licensing-authority/",
      label: "Zed Board",
    });
  });

  test("a license type attaches to the licensing authority only", async () => {
    const page = await annotationPage("AuthorityLicense", "al1", read);
    expect(page.attachment).toMatchObject({
      personnel_id: null,
      agency_id: null,
      licensing_authority_id: "la1",
    });
  });

  test("a report links to its stored path from the UTC incident date", async () => {
    expect((await annotationPage("Review", "r1", read)).links).toEqual([
      {
        url: "/zz/test-county/alpha/reports/2025/03/04/traffic-stop/",
        label: "Traffic stop",
      },
    ]);
  });

  test("a subject kind without a rule fails loudly", async () => {
    await expect(annotationPage("CoverageLink", "x", read)).rejects.toThrow(
      "Annotation subject kind CoverageLink has no page attachment rule.",
    );
  });
});

describe("annotationDisplayValue", () => {
  test("shows text, JSON text, and nothing for null or an internal reference", () => {
    expect(annotationDisplayValue("address", "1 Main St")).toBe("1 Main St");
    expect(annotationDisplayValue("latitude", 31.5)).toBe("31.5");
    expect(annotationDisplayValue("latitude", null)).toBeNull();
    expect(annotationDisplayValue("location_path_id", "lp-1")).toBeNull();
    expect(annotationDisplayValue("source_record_id", "abc")).toBe("abc");
  });

  test("shows the excluded record's name", () => {
    expect(
      annotationDisplayValue("excluded_records", {
        kind: "Agency",
        key: "k",
        name: "Old Agency",
      }),
    ).toBe("Old Agency");
  });
});
