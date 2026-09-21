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
        p,
        {
          location_path_id: p,
          path: p,
          level,
          display_name: name,
          parent_location_path_id: parent,
          latitude: "0",
          longitude: "0",
        },
      ]),
    ),
    locationPathSources: {
      "/mn/": { sourceKey: "state:GEOID:27" },
      "/mn/jackson-county/": { sourceKey: "administrative_area:GEOID:27063" },
      "/mn/jackson-county/alba/": { sourceKey: "place:GEOID:2700001" },
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
      result.built.locationPaths["/mn/jackson-county/alba-township/"],
    ).toMatchObject({
      level: "place",
      display_name: "Alba township",
      parent_location_path_id: "/mn/jackson-county/",
      resolution_class: "county_subdivision",
    });
    expect(result.built.locationPaths["/mn/jackson-county/alba/"]).toEqual(
      input.locationPaths["/mn/jackson-county/alba/"],
    );
    expect(
      result.built.locationPathSources["/mn/jackson-county/alba-township/"]
        .sourceKey,
    ).toBe("county_subdivision:GEOID:2706300604");
  });
  it("subtracts primary PLACE coverage and retains only the uncovered township geometry", () => {
    const result = run(
      [feature("2706300604", "Alba township", [0, 0, 4, 4])],
      [feature("2700001", "Alba", [0, 0, 2, 4])],
    );
    const geometry = result.geometries.get(
      "/mn/jackson-county/alba-township/",
    )!;
    expect(geometry.coordinates.flat(2).every(([x]) => x >= 2)).toBe(true);
    expect(result.report[0]).toMatchObject({
      geoid: "2706300604",
      status: "clipped",
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
      result.built.locationPaths["/mn/jackson-county/alba-township/"],
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
      result.built.locationPaths[
        "/mn/jackson-county/alba-consolidated-government/"
      ],
    ).toMatchObject({ resolution_class: "consolidated_city" });
  });
});
