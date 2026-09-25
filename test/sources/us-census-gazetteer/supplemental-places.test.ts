import { describe, expect, it } from "vitest";
import { addSupplementalPlaces } from "../../../sources/us-census-gazetteer/lib/supplemental-places.js";
import type { BuildLocationPathsResult } from "../../../sources/us-census-gazetteer/lib/location-paths.js";
import type { TigerFeatureRow } from "../../../sources/us-census-gazetteer/lib/tiger-hierarchy.js";

function feature(
  geoid: string,
  label: string,
  box: number[],
  properties: Record<string, unknown> = {},
): TigerFeatureRow {
  const [minX, minY, maxX, maxY] = box;
  return {
    geoid,
    name: label,
    label,
    type: "43",
    properties: {
      STATEFP: "27",
      COUNTYFP: "063",
      CLASSFP: "T1",
      ...properties,
    },
    bbox: { minX, minY, maxX, maxY },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
          [minX, minY],
        ],
      ],
    },
  };
}
function baseline(): BuildLocationPathsResult {
  const keys: Record<string, string> = {
    "/mn/": "state:GEOID:27",
    "/mn/jackson-county/": "administrative_area:GEOID:27063",
    "/mn/jackson-county/alba/": "place:GEOID:2700001",
  };
  return {
    locationPaths: Object.fromEntries(
      [
        ["/mn/", "state", "Minnesota", null],
        [
          "/mn/jackson-county/",
          "administrative_area",
          "Jackson County",
          "/mn/",
        ],
        ["/mn/jackson-county/alba/", "place", "Alba", "/mn/jackson-county/"],
      ].map(([p, level, name, parent]) => [
        keys[p!],
        {
          location_path_id: keys[p!],
          path: p,
          level,
          display_name: name,
          parent_location_path_id: parent === null ? null : keys[parent!],
          latitude: "0",
          longitude: "0",
        },
      ]),
    ),
    locationPathSources: {
      "state:GEOID:27": { sourceKey: "state:GEOID:27" },
      "administrative_area:GEOID:27063": {
        sourceKey: "administrative_area:GEOID:27063",
      },
      "place:GEOID:2700001": { sourceKey: "place:GEOID:2700001" },
    },
    locationPathAlias: {},
    locationPathAliasSources: {},
    warnings: [],
  } as BuildLocationPathsResult;
}
const county = feature("27063", "Jackson County", [0, 0, 10, 10]);
function run(
  subdivisions: TigerFeatureRow[],
  places: TigerFeatureRow[] = [],
  consolidatedCities: TigerFeatureRow[] = [],
) {
  return addSupplementalPlaces({
    built: baseline(),
    subdivisions,
    places,
    consolidatedCities,
    counties: [county],
  });
}
describe("Census supplemental places", () => {
  it("imports Alba township with its authoritative county and leaves existing city paths unchanged", () => {
    const input = baseline();
    const result = run([feature("2706300604", "Alba township", [0, 0, 4, 4])]);
    expect(
      result.built.locationPaths["county_subdivision:GEOID:2706300604"],
    ).toMatchObject({
      level: "place",
      display_name: "Alba township",
      parent_location_path_id: "administrative_area:GEOID:27063",
      resolution_class: "county_subdivision",
    });
    expect(result.built.locationPaths["place:GEOID:2700001"]).toEqual(
      input.locationPaths["place:GEOID:2700001"],
    );
    expect(
      result.built.locationPathSources["county_subdivision:GEOID:2706300604"]
        .sourceKey,
    ).toBe("county_subdivision:GEOID:2706300604");
  });
  it("retains the original township geometry when primary PLACE coverage overlaps it", () => {
    const township = feature("2706300604", "Alba township", [0, 0, 4, 4]);
    const result = run([township], [feature("2700001", "Alba", [0, 0, 2, 4])]);
    const geometry = result.geometries.get(
      "county_subdivision:GEOID:2706300604",
    )!;
    expect(geometry.coordinates).toEqual([township.geometry.coordinates]);
    expect(result.report[0]).toMatchObject({
      geoid: "2706300604",
      status: "included",
    });
  });
  it("skips a township fully covered by the union of two places without inventing an alias", () => {
    const result = run(
      [feature("2706300604", "Alba township", [0, 0, 4, 4])],
      [
        feature("2700001", "West", [0, 0, 2, 4]),
        feature("2700002", "East", [2, 0, 4, 4]),
      ],
    );
    expect(
      result.built.locationPaths["county_subdivision:GEOID:2706300604"],
    ).toBeUndefined();
    expect(result.built.locationPathAlias).toEqual({});
    expect(result.report[0]).toMatchObject({ status: "covered" });
  });
  it.each(["S2", "S3", "Z3", "Z5", "Z9"])(
    "excludes statistical/undefined class %s visibly",
    (CLASSFP) => {
      const result = run([
        feature("2706300604", "Alba CCD", [0, 0, 4, 4], { CLASSFP }),
      ]);
      expect(Object.keys(result.built.locationPaths)).toHaveLength(3);
      expect(result.report[0]).toMatchObject({
        status: "excluded",
        classCode: CLASSFP,
      });
    },
  );
  it("fails on unknown Census classification", () =>
    expect(() =>
      run([feature("2706300604", "Alba", [0, 0, 4, 4], { CLASSFP: "XX" })]),
    ).toThrow(/class/i));
  it("fails on a missing authoritative county", () =>
    expect(() =>
      run([
        feature("2799900604", "Alba township", [0, 0, 4, 4], {
          COUNTYFP: "999",
        }),
      ]),
    ).toThrow(/county/i));
  it("imports a consolidated government separately from the balance place", () => {
    const result = run(
      [],
      [],
      [
        feature("2700002", "Alba consolidated government", [0, 0, 4, 4], {
          CLASSFP: "C3",
        }),
      ],
    );
    expect(
      result.built.locationPaths["consolidated_city:GEOID:2700002"],
    ).toMatchObject({ resolution_class: "consolidated_city" });
  });
});
