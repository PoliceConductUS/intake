import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  parseSearch,
  parseEmployment,
  parseCertificates,
  parseAgency,
  nextPage,
  postbackFields,
} from "../sources/gov.or.dpsst/parse.js";
const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/oregon-dpsst/${name}.html`, import.meta.url),
    "utf8",
  );
describe("Oregon public HTML", () => {
  it("accepts the explicit certificate empty response", () =>
    expect(parseCertificates(fixture("certificates-empty"), "65863")).toEqual(
      [],
    ));
  it("extracts stable source identities and actual pagination", () => {
    expect(parseSearch(fixture("search"))[0]).toMatchObject({
      officerId: "65863",
      agencyId: "HBS",
      recordId: "32433",
      recordNumber: "67089",
    });
    expect(nextPage(fixture("search"), 1)).toEqual({
      target: "gvwEmployees",
      argument: "Page$2",
      page: 2,
    });
  });
  it("preserves underscores in source agency codes", () => {
    expect(
      parseSearch(fixture("search").replaceAll("HBS", "NPS_"))[0],
    ).toMatchObject({ agencyId: "NPS_" });
  });
  it("rejects missing tables and malformed rows", () => {
    expect(() => parseSearch("<html>Error</html>")).toThrow();
    expect(() =>
      parseSearch(fixture("search").replace("65863", "oops")),
    ).toThrow();
  });
  it("verifies officer identity and preserves source dates", () => {
    expect(parseEmployment(fixture("employment"), "13177")[0]).toMatchObject({
      date: "8/1/2021",
      action: "Retired",
    });
    expect(() => parseEmployment(fixture("employment"), "999")).toThrow(
      /identity/i,
    );
    expect(
      parseCertificates(fixture("certificates"), "13177")[0],
    ).toMatchObject({
      certificate: "Police Officer",
      certificateDate: "7/31/1986",
      status: "Expired",
    });
  });
  it("decodes contact email and keeps address boundaries", () => {
    expect(
      parseAgency(fixture("agency"), "Washington County Sheriff's Office"),
    ).toMatchObject({
      address: "215 SW Adams Avenue, MS #32",
      city: "Hillsboro",
      state: "OR",
      zipCode: "97123",
      contactEmail: "caprice_massey@washingtoncountyor.gov",
    });
  });
  it("accepts explicit no data only", () => {
    expect(parseAgency(fixture("agency-empty"), "Missing Agency")).toBeNull();
    expect(() =>
      parseAgency("<p>No Data Found</p>", "Missing Agency"),
    ).toThrow();
    expect(() =>
      parseCertificates('<td class="header_level1">ID: 13177</td>', "13177"),
    ).toThrow();
  });
  it("preserves hidden fields for postbacks and rejects missing viewstate", () => {
    expect(
      postbackFields(
        '<input type="hidden" name="__VIEWSTATE" value="abc&amp;def">',
      ).get("__VIEWSTATE"),
    ).toBe("abc&def");
    expect(() => postbackFields("")).toThrow();
  });
});
it("rejects truncated header-only and unexpected nested data tables", () => {
  const head =
    '<table id="gvwEmployees"><tr><th>Name</th><th>ID</th><th>Agency Name</th><th>Rank/Position</th><th>Status</th></tr>';
  expect(() => parseSearch(head + "</table>")).toThrow();
  expect(() =>
    parseSearch(
      head +
        "<tr><td><table><tr><td>broken</td></tr></table></td></tr></table>",
    ),
  ).toThrow();
});
it("fails unsupported pager commands rather than truncating", () =>
  expect(() =>
    nextPage(
      `<a href="javascript:__doPostBack('gvwEmployees','Page$Next')">Next</a>`,
      1,
    ),
  ).toThrow());

it("selects the unique agency name from a multi-result response", () => {
  expect(
    parseAgency(fixture("agency-multiple"), "National Park Service"),
  ).toMatchObject({
    name: "National Park Service",
    address: "Crater Lake National Park",
    contactName: "Kean Mihata",
  });
  expect(() =>
    parseAgency(fixture("agency-multiple"), "Unrelated Agency"),
  ).toThrow(/identity/i);
});
