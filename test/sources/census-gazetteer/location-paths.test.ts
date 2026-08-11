import { describe, expect, it } from "vitest";
import {
  buildLocationPaths,
  slugFromSourceName,
} from "../../../sources/census-gazetteer/lib/location-paths.js";

/**
 * Ported from `intake.census-gazetteer/test/location-paths.test.js`.
 * `buildLocationPaths` is pure and unchanged from the original — this test
 * is a byte-for-byte port (assertions translated from node:assert to
 * vitest's expect) and should pass unmodified against the ported logic.
 */

const mnState = {
  USPS: "MN",
  GEOID: "27",
  ANSICODE: "00662849",
  NAME: "Minnesota",
  ALAND: "206232157570",
  AWATER: "18949864226",
  INTPTLAT: "+46.3159573",
  INTPTLONG: "-094.1996043",
};
const hennepinCounty = {
  USPS: "MN",
  GEOID: "27053",
  ANSICODE: "00659474",
  NAME: "Hennepin County",
  ALAND: "1435241074",
  AWATER: "136701041",
  INTPTLAT: "+45.0045124",
  INTPTLONG: "-093.4768507",
};
const ramseyCounty = {
  USPS: "MN",
  GEOID: "27123",
  ANSICODE: "00659513",
  NAME: "Ramsey County",
  ALAND: "392377080",
  AWATER: "17095822",
  INTPTLAT: "+45.0152505",
  INTPTLONG: "-093.0995303",
};
const minneapolis = {
  USPS: "MN",
  GEOID: "2743000",
  ANSICODE: "02395722",
  NAME: "Minneapolis city",
  ALAND: "138912673",
  AWATER: "9501845",
  INTPTLAT: "+44.963324",
  INTPTLONG: "-093.268320",
};

describe("buildLocationPaths", () => {
  it("builds location path rows separately from source evidence", () => {
    const result = buildLocationPaths({
      states: [mnState],
      administrativeAreas: [hennepinCounty],
      places: [minneapolis],
      hierarchy: [
        {
          stateGeoid: "27",
          administrativeAreaGeoid: "27053",
          placeGeoid: "2743000",
          placeName: "Minneapolis",
          overlapTotalArea: 148414518,
          sourceKey: "census:overlap:2025:27:27053:2743000",
        },
      ],
    });

    const state = result.locationPaths["/mn/"];
    const admin = result.locationPaths["/mn/hennepin-county/"];
    const place = result.locationPaths["/mn/hennepin-county/minneapolis/"];

    expect(state.location_path_id).toBe("/mn/");
    expect(state.path).toBe("/mn/");
    expect(state.parent_location_path_id).toBe(null);
    expect(state.latitude).toBe("+46.3159573");
    expect(state.longitude).toBe("-094.1996043");
    expect(admin.parent_location_path_id).toBe("/mn/");
    expect(place.parent_location_path_id).toBe("/mn/hennepin-county/");
    expect(place.state_or_territory_slug).toBe("mn");
    expect(place.administrative_area_slug).toBe("hennepin-county");
    expect(place.place_slug).toBe("minneapolis");
    expect(place.place_name).toBe("Minneapolis");
    expect((state as unknown as Record<string, unknown>)._metadata).toBe(undefined);
    expect((admin as unknown as Record<string, unknown>)._metadata).toBe(undefined);
    expect((place as unknown as Record<string, unknown>)._metadata).toBe(undefined);
    expect(result.locationPathSources["/mn/"]).toEqual({
      sourceKey: "state:GEOID:27",
    });
    expect(result.locationPathSources["/mn/hennepin-county/"]).toEqual({
      sourceKey: "administrative_area:GEOID:27053",
      parentSourceKey: "state:GEOID:27",
    });
    expect(
      result.locationPathSources["/mn/hennepin-county/minneapolis/"]
        .sourceKey,
    ).toBe("place:GEOID:2743000");
    expect(
      result.locationPathSources["/mn/hennepin-county/minneapolis/"]
        .parentSourceKey,
    ).toBe("administrative_area:GEOID:27053");
    expect(
      (
        result.locationPathSources[
          "/mn/hennepin-county/minneapolis/"
        ] as unknown as Record<string, unknown>
      ).sourceGeographyNamespace,
    ).toBe(undefined);
    expect(
      result.locationPathSources["/mn/hennepin-county/minneapolis/"]
        .hierarchySelection,
    ).toBe(undefined);
    expect(result.locationPathAlias).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  it("uses common place names while preserving administrative-area suffixes", () => {
    expect(slugFromSourceName("Minneapolis")).toBe("minneapolis");
    expect(slugFromSourceName("Hennepin County")).toBe("hennepin-county");
  });

  it("fails when a place has no Census-proven parent", () => {
    expect(() =>
      buildLocationPaths({
        states: [mnState],
        administrativeAreas: [hennepinCounty],
        places: [minneapolis],
        hierarchy: [],
      }),
    ).toThrow(/Missing Census-proven parent for place 2743000 Minneapolis city/);
  });

  it("emits alternate admin paths as aliases for the same place", () => {
    const result = buildLocationPaths({
      states: [mnState],
      administrativeAreas: [hennepinCounty, ramseyCounty],
      places: [minneapolis],
      hierarchy: [
        {
          stateGeoid: "27",
          administrativeAreaGeoid: "27053",
          placeGeoid: "2743000",
          placeName: "Minneapolis",
          overlapTotalArea: 100,
          sourceKey: "census:overlap:2025:27:27053:2743000",
        },
        {
          stateGeoid: "27",
          administrativeAreaGeoid: "27123",
          placeGeoid: "2743000",
          placeName: "Minneapolis",
          overlapTotalArea: 50,
          sourceKey: "census:overlap:2025:27:27123:2743000",
        },
      ],
    });

    expect(result.locationPaths["/mn/hennepin-county/minneapolis/"]).toBeTruthy();
    expect(
      result.locationPathAlias["/mn/ramsey-county/minneapolis/"]
        .location_path_id,
    ).toBe("/mn/hennepin-county/minneapolis/");
    expect(
      result.locationPathAlias["/mn/ramsey-county/minneapolis/"].alias_path,
    ).toBe("/mn/ramsey-county/minneapolis/");
    expect(
      result.locationPathAliasSources["/mn/ramsey-county/minneapolis/"]
        .sourceKey,
    ).toBe("census:overlap:2025:27:27123:2743000");
    expect(
      (
        result.locationPathAlias[
          "/mn/ramsey-county/minneapolis/"
        ] as unknown as Record<string, unknown>
      )._metadata,
    ).toBe(undefined);

    expect(
      result.locationPathSources["/mn/hennepin-county/minneapolis/"]
        .hierarchySelection,
    ).toEqual({
      note: "Minneapolis spans Hennepin County and Ramsey County. Hennepin County is used for all PoliceConduct.org purposes because it has the largest total-area overlap with Minneapolis.",
      reason: "largest_total_area_overlap",
      selectedAdministrativeAreaSourceKey: "administrative_area:GEOID:27053",
      selectedAdministrativeAreaLabel: "Hennepin County",
      selectedAdministrativeAreaPath: "/mn/hennepin-county/",
      selectedOverlapTotalArea: 100,
      alternateAdministrativeAreas: [
        {
          sourceKey: "administrative_area:GEOID:27123",
          label: "Ramsey County",
          path: "/mn/ramsey-county/",
          aliasPath: "/mn/ramsey-county/minneapolis/",
          overlapTotalArea: 50,
        },
      ],
    });
  });

  it("uses exact Gazetteer NAME when hierarchy has no TIGER place NAME", () => {
    const result = buildLocationPaths({
      states: [{ ...mnState, USPS: "MD", GEOID: "24", NAME: "Maryland" }],
      administrativeAreas: [
        {
          ...hennepinCounty,
          USPS: "MD",
          GEOID: "24031",
          NAME: "Montgomery County",
        },
      ],
      places: [
        {
          ...minneapolis,
          USPS: "MD",
          GEOID: "2416620",
          NAME: "Chevy Chase town",
        },
        {
          ...minneapolis,
          USPS: "MD",
          GEOID: "2416625",
          NAME: "Chevy Chase CDP",
        },
        {
          ...minneapolis,
          USPS: "MD",
          GEOID: "2416787",
          NAME: "Chevy Chase Village town",
        },
      ],
      hierarchy: [
        {
          stateGeoid: "24",
          administrativeAreaGeoid: "24031",
          placeGeoid: "2416620",
          overlapTotalArea: 100,
          sourceKey: "census:overlap:2025:24:24031:2416620",
        },
        {
          stateGeoid: "24",
          administrativeAreaGeoid: "24031",
          placeGeoid: "2416625",
          overlapTotalArea: 100,
          sourceKey: "census:overlap:2025:24:24031:2416625",
        },
        {
          stateGeoid: "24",
          administrativeAreaGeoid: "24031",
          placeGeoid: "2416787",
          overlapTotalArea: 100,
          sourceKey: "census:overlap:2025:24:24031:2416787",
        },
      ],
    });

    expect(
      result.locationPaths["/md/montgomery-county/chevy-chase-town/"],
    ).toBeTruthy();
    expect(
      result.locationPaths["/md/montgomery-county/chevy-chase-cdp/"],
    ).toBeTruthy();
    expect(
      result.locationPaths["/md/montgomery-county/chevy-chase-village-town/"],
    ).toBeTruthy();
    expect(
      result.locationPaths["/md/montgomery-county/chevy-chase-town/"]
        .place_name,
    ).toBe("Chevy Chase town");
    expect(
      result.locationPaths["/md/montgomery-county/chevy-chase-cdp/"]
        .place_slug,
    ).toBe("chevy-chase-cdp");
    expect(
      result.locationPaths["/md/montgomery-county/chevy-chase-village-town/"]
        .place_name,
    ).toBe("Chevy Chase Village town");
    expect(
      result.locationPaths["/md/montgomery-county/chevy-chase-village-town/"]
        .place_slug,
    ).toBe("chevy-chase-village-town");
    expect(result.locationPathAlias).toEqual({});
  });

  it("groups same-parent Census places by TIGER NAME", () => {
    const result = buildLocationPaths({
      states: [{ ...mnState, USPS: "MD", GEOID: "24", NAME: "Maryland" }],
      administrativeAreas: [
        {
          ...hennepinCounty,
          USPS: "MD",
          GEOID: "24031",
          NAME: "Montgomery County",
        },
      ],
      places: [
        {
          ...minneapolis,
          USPS: "MD",
          GEOID: "2416620",
          NAME: "Chevy Chase town",
        },
        {
          ...minneapolis,
          USPS: "MD",
          GEOID: "2416625",
          NAME: "Chevy Chase CDP",
        },
      ],
      hierarchy: [
        {
          stateGeoid: "24",
          administrativeAreaGeoid: "24031",
          placeGeoid: "2416620",
          placeName: "Chevy Chase",
          overlapTotalArea: 100,
          sourceKey: "census:overlap:2025:24:24031:2416620",
        },
        {
          stateGeoid: "24",
          administrativeAreaGeoid: "24031",
          placeGeoid: "2416625",
          placeName: "Chevy Chase",
          overlapTotalArea: 100,
          sourceKey: "census:overlap:2025:24:24031:2416625",
        },
      ],
    });

    expect(
      result.locationPaths["/md/montgomery-county/chevy-chase/"],
    ).toBeTruthy();
    expect(
      result.locationPaths["/md/montgomery-county/chevy-chase/"].place_name,
    ).toBe("Chevy Chase");
    expect(
      result.locationPathSources["/md/montgomery-county/chevy-chase/"]
        .sourceKeys,
    ).toEqual(["place:GEOID:2416620", "place:GEOID:2416625"]);
  });

  it("breaks equal-overlap default path ties by lexical path", () => {
    const result = buildLocationPaths({
      states: [mnState],
      administrativeAreas: [ramseyCounty, hennepinCounty],
      places: [minneapolis],
      hierarchy: [
        {
          stateGeoid: "27",
          administrativeAreaGeoid: "27123",
          placeGeoid: "2743000",
          placeName: "Minneapolis",
          overlapTotalArea: 100,
          sourceKey: "census:overlap:2025:27:27123:2743000",
        },
        {
          stateGeoid: "27",
          administrativeAreaGeoid: "27053",
          placeGeoid: "2743000",
          placeName: "Minneapolis",
          overlapTotalArea: 100,
          sourceKey: "census:overlap:2025:27:27053:2743000",
        },
      ],
    });

    expect(result.locationPaths["/mn/hennepin-county/minneapolis/"]).toBeTruthy();
    expect(
      result.locationPathAlias["/mn/ramsey-county/minneapolis/"]
        .location_path_id,
    ).toBe("/mn/hennepin-county/minneapolis/");
    expect(
      result.locationPathSources["/mn/hennepin-county/minneapolis/"]
        .hierarchySelection?.reason,
    ).toBe("largest_total_area_overlap_then_lexical_path");
    expect(
      result.locationPathSources["/mn/hennepin-county/minneapolis/"]
        .hierarchySelection?.note,
    ).toBe(
      "Minneapolis spans Hennepin County and Ramsey County. Hennepin County is used for all PoliceConduct.org purposes because it ties for the largest total-area overlap with Minneapolis and has the first path in lexical order.",
    );
  });

  it("fails on duplicate generated paths", () => {
    expect(() =>
      buildLocationPaths({
        states: [mnState],
        administrativeAreas: [hennepinCounty, { ...hennepinCounty, GEOID: "27001" }],
        places: [],
        hierarchy: [],
      }),
    ).toThrow(/Duplicate generated location path \/mn\/hennepin-county\//);
  });

  it("reports skipped non-required geographies", () => {
    const result = buildLocationPaths({
      states: [{ ...mnState, USPS: "PR", GEOID: "72", NAME: "Puerto Rico" }],
      administrativeAreas: [],
      places: [],
      hierarchy: [],
    });

    expect(result.locationPaths).toEqual({});
    expect(result.warnings).toEqual([
      'skipped state: /pr/ due to outside 50 states plus District of Columbia (source GEOID 72, label "Puerto Rico", lat +46.3159573, lng -094.1996043)',
    ]);
  });

  it("reports skipped administrative areas with source context", () => {
    const result = buildLocationPaths({
      states: [],
      administrativeAreas: [
        {
          ...hennepinCounty,
          USPS: "PR",
          GEOID: "72001",
          NAME: "Adjuntas Municipio",
          INTPTLAT: "+18.179",
          INTPTLONG: "-066.754",
        },
      ],
      places: [],
      hierarchy: [],
    });

    expect(result.locationPaths).toEqual({});
    expect(result.warnings).toEqual([
      'skipped administrative_area: /pr/adjuntas-municipio/ due to missing generated state parent (source GEOID 72001, label "Adjuntas Municipio", lat +18.179, lng -066.754, parent state GEOID 72, parent slug pr)',
    ]);
  });

  it("fails when a skipped administrative area is needed for place hierarchy", () => {
    expect(() =>
      buildLocationPaths({
        states: [mnState],
        administrativeAreas: [],
        places: [minneapolis],
        hierarchy: [
          {
            stateGeoid: "27",
            administrativeAreaGeoid: "27053",
            placeGeoid: "2743000",
            overlapTotalArea: 100,
            sourceKey: "census:overlap:2025:27:27053:2743000",
          },
        ],
      }),
    ).toThrow(/Missing Census-proven parent for place 2743000 Minneapolis city/);
  });
});
