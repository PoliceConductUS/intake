import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildHierarchyFromTiger,
  readCachedStateHierarchy,
  readFeaturesByState,
  toClippingGeometry,
  writeCachedStateHierarchy,
} from "../../../sources/census-gazetteer/lib/tiger-hierarchy.js";

/**
 * Ported from `intake.census-gazetteer/test/tiger-hierarchy.test.js`.
 *
 * The original test file only covered `logHierarchyProgress` (producer-CLI
 * progress logging, dropped in this port — see `tiger-hierarchy.ts`'s file
 * comment) and the per-state hierarchy cache read/write functions; the
 * original repo has no fixture-based test of `buildHierarchyFromTiger` /
 * `readFeaturesByState` / `toClippingGeometry` themselves (no shapefile
 * fixtures exist anywhere in that repo — those functions were validated
 * only by live runs against real TIGER data).
 *
 * This port keeps the cache tests (adapted: the cache path is now derived
 * from `state` instead of a caller-supplied `hierarchyCachePath`, per the
 * Task 4 rewire) and adds new fixture-based coverage for the bbox-prefilter
 * + `polygon-clipping` intersection engine and the zip-extraction rewire,
 * since those were previously only exercised end-to-end against real
 * Census data. Fixtures under `fixtures/tiger/` are small hand-built TIGER
 * shapefiles (`tl_2025_us_county.zip`, `tl_2025_27_place.zip`) validated by
 * round-tripping them through the Phase-1 `readShapefile` helper.
 */

const countyZip = fileURLToPath(
  new URL("./fixtures/tiger/tl_2025_us_county.zip", import.meta.url),
);
const placeZip = fileURLToPath(
  new URL("./fixtures/tiger/tl_2025_27_place.zip", import.meta.url),
);
const placeGeoJson = fileURLToPath(
  new URL("./fixtures/tiger/tl_2025_27_place.geojson", import.meta.url),
);

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "tiger-hierarchy-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("toClippingGeometry", () => {
  it("wraps a Polygon's coordinates as a single-polygon MultiPolygon", () => {
    const geometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ],
    };
    expect(toClippingGeometry(geometry)).toEqual([geometry.coordinates]);
  });

  it("passes a MultiPolygon's coordinates through unchanged", () => {
    const coordinates = [
      [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ],
    ];
    expect(toClippingGeometry({ type: "MultiPolygon", coordinates })).toBe(
      coordinates,
    );
  });

  it("returns undefined for unsupported or missing geometry", () => {
    expect(
      toClippingGeometry({ type: "Point", coordinates: [0, 0] }),
    ).toBeUndefined();
    expect(toClippingGeometry(undefined)).toBeUndefined();
  });
});

describe("readFeaturesByState", () => {
  it("reads a TIGER place shapefile out of a zip archive, filtering to allowed states", async () => {
    const featuresByState = await readFeaturesByState(
      placeZip,
      "place",
      workDir,
    );

    expect([...featuresByState.keys()]).toEqual(["27"]);
    const mnPlaces = featuresByState.get("27") ?? [];
    expect(mnPlaces.map((place) => place.geoid).sort()).toEqual([
      "2701000",
      "2743000",
    ]);

    const minneapolis = mnPlaces.find((place) => place.geoid === "2743000");
    expect(minneapolis).toMatchObject({
      geoid: "2743000",
      name: "Minneapolis",
      label: "Minneapolis city",
      type: "25",
      bbox: { minX: 2, minY: 2, maxX: 6, maxY: 6 },
    });
    expect(minneapolis?.geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [2, 2],
          [2, 6],
          [6, 6],
          [6, 2],
          [2, 2],
        ],
      ],
    });

    // The Puerto Rico (STATEFP 72) record is outside allowedStateGeoids and
    // must not appear under any key.
    expect(featuresByState.has("72")).toBe(false);
  });

  it("extracts the zip into a temp directory under the injected state", async () => {
    await readFeaturesByState(countyZip, "county", workDir);
    const extracted = await readFile(
      path.join(workDir, "tmp", "tl_2025_us_county", "tl_2025_us_county.shp"),
    );
    expect(extracted.byteLength).toBeGreaterThan(0);
  });

  it("reads a plain .geojson path, filtering to allowed states the same way", async () => {
    const featuresByState = await readFeaturesByState(
      placeGeoJson,
      "place",
      workDir,
    );

    expect([...featuresByState.keys()]).toEqual(["27"]);
    expect(featuresByState.get("27")).toEqual([
      {
        geoid: "2743000",
        name: "Minneapolis",
        label: "Minneapolis city",
        type: "25",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [2, 2],
              [2, 6],
              [6, 6],
              [6, 2],
              [2, 2],
            ],
          ],
        },
        bbox: { minX: 2, minY: 2, maxX: 6, maxY: 6 },
      },
    ]);
  });
});

describe("buildHierarchyFromTiger", () => {
  it("derives place-county overlap records via the bbox prefilter + intersection engine, sorted by the compound key", async () => {
    const hierarchy = await buildHierarchyFromTiger({
      countyShapefilePath: countyZip,
      placeShapefilePaths: [placeZip],
      selectedYear: "2025",
      state: workDir,
    });

    // Minneapolis (record 1 in the fixture, GEOID 2743000) is read before
    // Anytown (record 3, GEOID 2701000), so this also proves the final
    // `stateGeoid:placeGeoid:administrativeAreaGeoid:sourceKey` sort
    // reorders the pre-sort [2743000, 2701000] insertion order.
    expect(hierarchy).toEqual([
      {
        stateGeoid: "27",
        administrativeAreaGeoid: "27053",
        placeGeoid: "2701000",
        overlapTotalArea: 4 * 1e12,
        sourceKey: "us-census-tiger:overlap:2025:27:27053:2701000",
        placeName: "Anytown",
        placeLabel: "Anytown city",
      },
      {
        stateGeoid: "27",
        administrativeAreaGeoid: "27053",
        placeGeoid: "2743000",
        overlapTotalArea: 16 * 1e12,
        sourceKey: "us-census-tiger:overlap:2025:27:27053:2743000",
        placeName: "Minneapolis",
        placeLabel: "Minneapolis city",
      },
    ]);
  });

  it("writes a per-state hierarchy cache artifact under state/hierarchy/<stateGeoid>.json", async () => {
    await buildHierarchyFromTiger({
      countyShapefilePath: countyZip,
      placeShapefilePaths: [placeZip],
      selectedYear: "2025",
      state: workDir,
    });

    const cacheFile = path.join(workDir, "hierarchy", "27.json");
    const parsed = JSON.parse(await readFile(cacheFile, "utf8"));
    expect(parsed.selectedYear).toBe("2025");
    expect(parsed.stateGeoid).toBe("27");
    expect(parsed.records).toHaveLength(2);
  });

  it("short-circuits on a cache hit instead of recomputing", async () => {
    const fabricatedRecords = [
      {
        stateGeoid: "27",
        administrativeAreaGeoid: "99999",
        placeGeoid: "2799999",
        overlapTotalArea: 42,
        sourceKey: "fabricated:cache-hit",
      },
    ];
    await writeCachedStateHierarchy({
      state: workDir,
      selectedYear: "2025",
      stateGeoid: "27",
      records: fabricatedRecords,
    });

    const hierarchy = await buildHierarchyFromTiger({
      countyShapefilePath: countyZip,
      placeShapefilePaths: [placeZip],
      selectedYear: "2025",
      state: workDir,
    });

    expect(hierarchy).toEqual(fabricatedRecords);
  });

  it("throws when no place overlaps any county", async () => {
    await expect(
      buildHierarchyFromTiger({
        countyShapefilePath: countyZip,
        placeShapefilePaths: [],
        selectedYear: "2025",
        state: workDir,
      }),
    ).rejects.toThrow("No authoritative Census hierarchy source was acquired");
  });
});

describe("state hierarchy cache", () => {
  it("can resume completed states", async () => {
    const records = [
      {
        stateGeoid: "27",
        administrativeAreaGeoid: "27053",
        placeGeoid: "2743000",
        overlapTotalArea: 100,
        sourceKey: "us-census-tiger:overlap:2025:27:27053:2743000",
      },
    ];

    await writeCachedStateHierarchy({
      state: workDir,
      selectedYear: "2025",
      stateGeoid: "27",
      records,
    });

    await expect(
      readCachedStateHierarchy({
        state: workDir,
        selectedYear: "2025",
        stateGeoid: "27",
      }),
    ).resolves.toEqual(records);
    await expect(
      readFile(path.join(workDir, "hierarchy", "27.json"), "utf8"),
    ).resolves.toMatch(/"selectedYear": "2025"/);
  });

  it("writes atomically via a temp-file-then-rename", async () => {
    await writeCachedStateHierarchy({
      state: workDir,
      selectedYear: "2025",
      stateGeoid: "27",
      records: [],
    });

    const hierarchyDir = path.join(workDir, "hierarchy");
    const entries = await readdir(hierarchyDir);
    expect(entries).toEqual(["27.json"]);
  });

  it("returns undefined (no cache hit) when no artifact exists yet", async () => {
    await expect(
      readCachedStateHierarchy({
        state: workDir,
        selectedYear: "2025",
        stateGeoid: "27",
      }),
    ).resolves.toBeUndefined();
  });

  it("fails loudly on mismatched run metadata", async () => {
    await mkdir(path.join(workDir, "hierarchy"), { recursive: true });
    await writeFile(
      path.join(workDir, "hierarchy", "27.json"),
      JSON.stringify({
        selectedYear: "2024",
        stateGeoid: "27",
        records: [],
      }),
    );

    await expect(
      readCachedStateHierarchy({
        state: workDir,
        selectedYear: "2025",
        stateGeoid: "27",
      }),
    ).rejects.toThrow("Cached hierarchy state artifact does not match run");
  });
});
