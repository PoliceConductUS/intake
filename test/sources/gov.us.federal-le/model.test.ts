import { describe, it, expect } from "vitest";
import {
  officeIsComplete,
  type Office,
} from "../../../sources/gov.us.federal-le/model.js";

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
