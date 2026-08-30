import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildLocationPathGeometryPackage } from "../../../sources/us-census-gazetteer/lib/location-geometries.js";
import type { LocationPathRow } from "../../../sources/us-census-gazetteer/lib/location-paths.js";

/**
 * Ported from `intake.us-census-gazetteer/test/location-geometries.test.js`.
 *
 * The geometry/bbox/centroid computation and the `onGeometryRow` streaming
 * seam are covered exactly as in the original. The original's third test
 * ("reuses cached centroid and bbox only when source key matches") exercised
 * the `locationPathSourceCache` perf cache, which the migration dropped (see
 * `location-geometries.ts`'s file comment) — it is replaced here with a test
 * that bbox/centroid are always recomputed from the source geometry (no
 * cache parameter exists anymore to short-circuit that computation).
 */

async function writeGeoJson(
  filePath: string,
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: { type: "Polygon"; coordinates: [number, number][][] };
  }>,
): Promise<void> {
  await writeFile(
    filePath,
    JSON.stringify({
      type: "FeatureCollection",
      features,
    }),
  );
}

function feature(
  properties: Record<string, unknown>,
  coordinates: [number, number][],
) {
  return {
    type: "Feature" as const,
    properties,
    geometry: {
      type: "Polygon" as const,
      coordinates: [coordinates],
    },
  };
}

function locationPath(
  location_path_id: string,
  level: LocationPathRow["level"],
): LocationPathRow {
  return {
    location_path_id,
    path: location_path_id,
    level,
    display_name: "Minnesota",
    parent_location_path_id: null,
    latitude: "0",
    longitude: "0",
  };
}

let directory: string;
let state: string;
let stateGeometryPath: string;
let countyGeometryPath: string;
let placeGeometryPath: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "census-geometries-test-"));
  state = await mkdtemp(path.join(tmpdir(), "census-geometries-state-"));
  stateGeometryPath = path.join(directory, "state.geojson");
  countyGeometryPath = path.join(directory, "county.geojson");
  placeGeometryPath = path.join(directory, "place.geojson");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  await rm(state, { recursive: true, force: true });
});

describe("buildLocationPathGeometryPackage", () => {
  it("builds one geometry row for each canonical location path", async () => {
    await writeGeoJson(stateGeometryPath, [
      feature(
        {
          STATEFP: "27",
          STUSPS: "MN",
          GEOID: "27",
          NAME: "Minnesota",
          NAMELSAD: "Minnesota",
          LSAD: "00",
        },
        [
          [-95, 43],
          [-92, 43],
          [-92, 46],
          [-95, 46],
          [-95, 43],
        ],
      ),
    ]);
    await writeGeoJson(countyGeometryPath, [
      feature(
        {
          STATEFP: "27",
          STUSPS: "MN",
          GEOID: "27053",
          NAME: "Hennepin",
          NAMELSAD: "Hennepin County",
          LSAD: "06",
        },
        [
          [-94, 44],
          [-93, 44],
          [-93, 45],
          [-94, 45],
          [-94, 44],
        ],
      ),
    ]);
    await writeGeoJson(placeGeometryPath, [
      feature(
        {
          STATEFP: "27",
          PLACEFP: "43000",
          GEOID: "2743000",
          NAME: "Minneapolis",
          NAMELSAD: "Minneapolis city",
          LSAD: "25",
        },
        [
          [-93.5, 44.2],
          [-93.2, 44.2],
          [-93.2, 44.6],
          [-93.5, 44.6],
          [-93.5, 44.2],
        ],
      ),
      feature(
        {
          STATEFP: "24",
          PLACEFP: "16620",
          GEOID: "2416620",
          NAME: "Chevy Chase",
          NAMELSAD: "Chevy Chase town",
          LSAD: "43",
        },
        [
          [-77.1, 38.98],
          [-77.08, 38.98],
          [-77.08, 39],
          [-77.1, 39],
          [-77.1, 38.98],
        ],
      ),
      feature(
        {
          STATEFP: "24",
          PLACEFP: "16625",
          GEOID: "2416625",
          NAME: "Chevy Chase",
          NAMELSAD: "Chevy Chase CDP",
          LSAD: "57",
        },
        [
          [-77.08, 38.98],
          [-77.06, 38.98],
          [-77.06, 39],
          [-77.08, 39],
          [-77.08, 38.98],
        ],
      ),
    ]);

    const geometryPackage = await buildLocationPathGeometryPackage({
      selectedYear: 2025,
      state,
      stateGeometryPath,
      countyGeometryPath,
      placeGeometryPaths: [placeGeometryPath],
      locationPaths: {
        "/mn/": locationPath("/mn/", "state"),
        "/mn/hennepin-county/": locationPath(
          "/mn/hennepin-county/",
          "administrative_area",
        ),
        "/mn/hennepin-county/minneapolis/": locationPath(
          "/mn/hennepin-county/minneapolis/",
          "place",
        ),
        "/md/montgomery-county/chevy-chase/": locationPath(
          "/md/montgomery-county/chevy-chase/",
          "place",
        ),
      },
      locationPathSources: {
        "/mn/": { sourceKey: "state:GEOID:27" },
        "/mn/hennepin-county/": {
          sourceKey: "administrative_area:GEOID:27053",
        },
        "/mn/hennepin-county/minneapolis/": {
          sourceKey: "place:GEOID:2743000",
        },
        "/md/montgomery-county/chevy-chase/": {
          sourceKey: "place:GEOID:2416620",
          sourceKeys: ["place:GEOID:2416620", "place:GEOID:2416625"],
        },
      },
    });
    const geometries = geometryPackage.locationPathGeometries!;

    expect(Object.keys(geometries)).toEqual([
      "/md/montgomery-county/chevy-chase/",
      "/mn/",
      "/mn/hennepin-county/",
      "/mn/hennepin-county/minneapolis/",
    ]);
    expect(geometries["/mn/"].geometry).toEqual({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [-95, 43],
            [-92, 43],
            [-92, 46],
            [-95, 46],
            [-95, 43],
          ],
        ],
      ],
    });
    expect(geometryPackage.locationPaths["/mn/"].bbox).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [-95, 43],
          [-92, 43],
          [-92, 46],
          [-95, 46],
          [-95, 43],
        ],
      ],
    });
    expect(geometryPackage.locationPaths["/mn/"].centroid).toEqual({
      type: "Point",
      coordinates: [-93.5, 44.5],
    });
    expect(
      geometryPackage.locationPathGeometrySources["/mn/hennepin-county/"]
        .sourceKey,
    ).toBe("geometry:administrative_area:GEOID:27053");
    expect(
      geometryPackage.locationPathGeometrySources[
        "/mn/hennepin-county/minneapolis/"
      ].sourceKey,
    ).toBe("geometry:place:GEOID:2743000");
    expect(
      geometryPackage.locationPathGeometrySources[
        "/md/montgomery-county/chevy-chase/"
      ].sourceKey,
    ).toBe("geometry:place:GEOID:2416620+2416625");
    expect(
      geometries["/md/montgomery-county/chevy-chase/"].geometry.coordinates
        .length,
    ).toBe(2);
    expect(
      (geometries["/mn/hennepin-county/"] as unknown as { _metadata?: unknown })
        ._metadata,
    ).toBeUndefined();
    expect(
      geometries["/mn/hennepin-county/minneapolis/"].location_path_id,
    ).toBe("/mn/hennepin-county/minneapolis/");
  });

  it("can stream geometry rows without retaining geometry records", async () => {
    await writeGeoJson(stateGeometryPath, [
      feature(
        {
          STATEFP: "27",
          STUSPS: "MN",
          GEOID: "27",
          NAME: "Minnesota",
          NAMELSAD: "Minnesota",
          LSAD: "00",
        },
        [
          [-95, 43],
          [-92, 43],
          [-92, 46],
          [-95, 46],
          [-95, 43],
        ],
      ),
    ]);
    await writeGeoJson(countyGeometryPath, []);
    await writeGeoJson(placeGeometryPath, []);

    const streamedRows: Array<[string, unknown]> = [];
    const geometryPackage = await buildLocationPathGeometryPackage({
      selectedYear: 2025,
      state,
      stateGeometryPath,
      countyGeometryPath,
      placeGeometryPaths: [placeGeometryPath],
      locationPaths: {
        "/mn/": locationPath("/mn/", "state"),
      },
      locationPathSources: {
        "/mn/": { sourceKey: "state:GEOID:27" },
      },
      onGeometryRow: async (key, row) => {
        streamedRows.push([key, row]);
      },
    });

    expect(geometryPackage.locationPathGeometries).toBeUndefined();
    expect(geometryPackage.locationPathGeometryCount).toBe(1);
    expect(streamedRows.length).toBe(1);
    expect(streamedRows[0][0]).toBe("/mn/");
    expect(
      (streamedRows[0][1] as { _metadata?: unknown })._metadata,
    ).toBeUndefined();
    expect(
      geometryPackage.locationPathGeometrySources["/mn/"].sourceLocationPathKey,
    ).toBe("/mn/");
    expect(
      geometryPackage.locationPathGeometrySources["/mn/"].sourceGeometryKey,
    ).toBe("state:GEOID:27");
    expect(geometryPackage.locationPaths["/mn/"].centroid.type).toBe("Point");
  });

  it("always recomputes bbox and centroid from the source geometry (no perf cache)", async () => {
    await writeGeoJson(stateGeometryPath, [
      feature(
        {
          STATEFP: "27",
          STUSPS: "MN",
          GEOID: "27",
          NAME: "Minnesota",
          NAMELSAD: "Minnesota",
          LSAD: "00",
        },
        [
          [-95, 43],
          [-92, 43],
          [-92, 46],
          [-95, 46],
          [-95, 43],
        ],
      ),
    ]);
    await writeGeoJson(countyGeometryPath, [
      feature(
        {
          STATEFP: "27",
          STUSPS: "MN",
          GEOID: "27053",
          NAME: "Hennepin",
          NAMELSAD: "Hennepin County",
          LSAD: "06",
        },
        [
          [-94, 44],
          [-93, 44],
          [-93, 45],
          [-94, 45],
          [-94, 44],
        ],
      ),
    ]);
    await writeGeoJson(placeGeometryPath, []);

    // Two runs with identical inputs (and thus identical source keys) must
    // independently recompute the same bbox/centroid values every time —
    // there is no cache parameter left to short-circuit that computation.
    const buildOnce = () =>
      buildLocationPathGeometryPackage({
        selectedYear: 2025,
        state,
        stateGeometryPath,
        countyGeometryPath,
        placeGeometryPaths: [placeGeometryPath],
        locationPaths: {
          "/mn/": locationPath("/mn/", "state"),
          "/mn/hennepin-county/": locationPath(
            "/mn/hennepin-county/",
            "administrative_area",
          ),
        },
        locationPathSources: {
          "/mn/": { sourceKey: "state:GEOID:27" },
          "/mn/hennepin-county/": {
            sourceKey: "administrative_area:GEOID:27053",
          },
        },
      });

    const first = await buildOnce();
    const second = await buildOnce();

    expect(first.locationPaths["/mn/"].centroid).toEqual({
      type: "Point",
      coordinates: [-93.5, 44.5],
    });
    expect(first.locationPaths["/mn/hennepin-county/"].centroid).toEqual({
      type: "Point",
      coordinates: [-93.5, 44.5],
    });
    expect(first.locationPaths["/mn/hennepin-county/"].bbox).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [-94, 44],
          [-93, 44],
          [-93, 45],
          [-94, 45],
          [-94, 44],
        ],
      ],
    });
    expect(second.locationPaths["/mn/"].centroid).toEqual(
      first.locationPaths["/mn/"].centroid,
    );
    expect(second.locationPaths["/mn/hennepin-county/"].bbox).toEqual(
      first.locationPaths["/mn/hennepin-county/"].bbox,
    );
  });
});
