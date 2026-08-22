import { describe, it, expect } from "vitest";
import {
  mergeOrgs,
  officeIsComplete,
  type Office,
} from "../../../sources/gov.us.federal-le/model.js";

describe("mergeOrgs", () => {
  it("adds newly discovered agencies and preserves existing ones, sorted by slug", () => {
    const { orgs, added } = mergeOrgs(
      [{ slug: "fbi", name: "FBI" }],
      [
        { slug: "fbi", name: "FBI (renamed upstream)" },
        { slug: "dea", name: "DEA" },
      ],
    );
    expect(added).toEqual(["dea"]);
    expect(orgs).toEqual([
      { slug: "dea", name: "DEA" },
      { slug: "fbi", name: "FBI" },
    ]);
  });
});

describe("officeIsComplete", () => {
  const complete: Office = {
    federal_agency: "fbi",
    slug: "fbi-hq",
    name: "FBI HQ",
    state: "DC",
    city: "Washington",
    address: "935 Pennsylvania Avenue NW",
    zip_code: "20535",
  };

  it("is true when every field is filled", () => {
    expect(officeIsComplete(complete)).toBe(true);
  });

  it("is false when any location field is blank", () => {
    expect(officeIsComplete({ ...complete, address: "" })).toBe(false);
    expect(officeIsComplete({ ...complete, state: " " })).toBe(false);
    expect(officeIsComplete({ ...complete, federal_agency: "" })).toBe(false);
  });
});
