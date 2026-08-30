import { describe, it, expect } from "vitest";
import { discoverLatestGazetteerLinks } from "../../../sources/us-census-gazetteer/acquire/discovery.js";

const BASE = "https://www.census.gov/geographies/gazetteer-files.html";
const W2 = "https://www2.census.gov";

function anchor(href: string, label: string): string {
  return `<a href="${href}">${label}</a>`;
}

function page(links: string[]): string {
  return `<html><body>${links.join("\n")}</body></html>`;
}

const gazetteer2024 = [
  anchor(
    `${W2}/geo/.../2024_Gazetteer/2024_Gaz_state_national.zip`,
    "2024 State",
  ),
  anchor(
    `${W2}/geo/.../2024_Gazetteer/2024_Gaz_counties_national.zip`,
    "2024 Counties",
  ),
  anchor(
    `${W2}/geo/.../2024_Gazetteer/2024_Gaz_place_national.zip`,
    "2024 Place",
  ),
];

describe("discoverLatestGazetteerLinks", () => {
  it("discovers gazetteer + TIGER links for the latest year", () => {
    const links = discoverLatestGazetteerLinks(
      page([
        ...gazetteer2024,
        anchor(`${W2}/geo/tiger/TIGER2024/STATE/tl_2024_us_state.zip`, "state"),
        anchor(
          `${W2}/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip`,
          "county",
        ),
        anchor(
          `${W2}/geo/tiger/TIGER2024/PLACE/tl_2024_27_place.zip`,
          "MN place",
        ),
      ]),
      BASE,
    );

    expect(links.year).toBe("2024");
    expect(links.stateUrl).toBe(
      `${W2}/geo/.../2024_Gazetteer/2024_Gaz_state_national.zip`,
    );
    expect(links.administrativeAreaUrl).toContain("2024_Gaz_counties_national");
    expect(links.placesUrl).toContain("2024_Gaz_place_national");
    expect(links.stateTigerUrl).toContain("tl_2024_us_state.zip");
    expect(links.placeTigerUrls).toEqual([
      `${W2}/geo/tiger/TIGER2024/PLACE/tl_2024_27_place.zip`,
    ]);
  });

  it("falls back to constructed TIGER urls when the page has none", () => {
    const links = discoverLatestGazetteerLinks(page(gazetteer2024), BASE);
    expect(links.stateTigerUrl).toBe(
      `${W2}/geo/tiger/TIGER2024/STATE/tl_2024_us_state.zip`,
    );
    expect(links.countyTigerUrl).toBe(
      `${W2}/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip`,
    );
    expect(links.placeTigerUrls).toHaveLength(51);
    expect(links.placeTigerUrls[0]).toBe(
      `${W2}/geo/tiger/TIGER2024/PLACE/tl_2024_01_place.zip`,
    );
  });

  it("prefers the latest year that has a complete gazetteer set", () => {
    const links = discoverLatestGazetteerLinks(
      page([
        // 2025 is newer but only has a state file — incomplete
        anchor(`${W2}/geo/.../2025_Gaz_state_national.zip`, "2025 State"),
        ...gazetteer2024,
      ]),
      BASE,
    );
    expect(links.year).toBe("2024");
  });

  it("throws when no complete gazetteer year is present", () => {
    expect(() =>
      discoverLatestGazetteerLinks(
        page([anchor(`${W2}/geo/.../2024_Gaz_state_national.zip`, "state")]),
        BASE,
      ),
    ).toThrow(/Missing required 2024 Gazetteer source links/);
  });
});
