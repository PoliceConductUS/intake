import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { transform } from "../../../sources/us-census-gazetteer/transform.js";
import { buildArtifactsEnvelope } from "../../../src/cli/transform/source-transform.js";
import {
  LocationPathGeometrySpec,
  LocationPathSpec,
} from "../../../src/shared/io/index.js";

/**
 * Synthetic end-to-end coverage for `sources/us-census-gazetteer/transform.ts`'s
 * `transform()` — the Phase-2 Task 7 orchestrator wiring the six ported domain
 * modules (`inputs`, `gazetteer-parser`, `hierarchy-parser`/`tiger-hierarchy`,
 * `location-paths`, `location-geometries`) into the runtime's manifest+emit
 * `SourceTransform` contract.
 *
 * Uses one synthetic state (MN, GEOID 27) built from the small fixtures the
 * earlier Phase-2 tasks already produced: `fixtures/states.psv`,
 * `fixtures/admin-areas.psv`, `fixtures/places.psv` (zipped here as the
 * Gazetteer `.txt` sources) and `fixtures/tiger/tl_2025_us_county.zip` /
 * `tl_2025_27_place.zip` (already hand-built, TIGER-shaped shapefile zips
 * proven valid by `tiger-hierarchy.test.ts`). No hierarchy/relationship file
 * is supplied, so this also exercises the `buildHierarchyFromTiger` branch
 * (bbox-prefilter + polygon-clipping) rather than the relationship-file
 * shortcut. A new `tl_2025_us_state.zip` fixture (single MN polygon,
 * `[-95,43]`–`[-92,46]`) was hand-built the same way for this task, verified
 * by round-tripping it through `readShapefile` before being committed.
 *
 * No real Census data and no network/database access — fully deterministic
 * and fast.
 */

const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));
const tigerDir = path.join(fixturesDir, "tiger");

const paths = [
  path.join(fixturesDir, "2025_Gaz_state_national.zip"),
  path.join(fixturesDir, "2025_Gaz_counties_national.zip"),
  path.join(fixturesDir, "2025_Gaz_place_national.zip"),
  path.join(tigerDir, "tl_2025_us_state.zip"),
  path.join(tigerDir, "tl_2025_us_county.zip"),
  path.join(tigerDir, "tl_2025_27_place.zip"),
  path.join(tigerDir, "tl_2025_27_cousub.zip"),
];

const notUsed = async () => {
  throw new Error(
    "readXlsx should not be called by us-census-gazetteer's transform()",
  );
};

let state: string;

beforeEach(async () => {
  state = await mkdtemp(path.join(tmpdir(), "us-census-gazetteer-run-test-"));
});

afterEach(async () => {
  await rm(state, { recursive: true, force: true });
});

describe("us-census-gazetteer run", () => {
  it("orchestrates the ported modules into a valid LocationPaths artifact plus streamed geometries", async () => {
    const emitted: Array<[string, string, unknown]> = [];
    const emit = async (kind: string, key: string, spec: unknown) => {
      emitted.push([kind, key, spec]);
    };

    const manifest = await transform({ paths, readXlsx: notUsed, state, emit });

    // --- manifest.artifacts: LocationPaths only (no alternate-admin-area
    // aliases arise from this single-county fixture) ---
    expect(manifest.artifacts.map((artifact) => artifact.kind)).toEqual([
      "LocationPaths",
    ]);
    const locationPaths = manifest.artifacts[0].records;
    expect(Object.keys(locationPaths).sort()).toEqual([
      "administrative_area:GEOID:27053",
      "county_subdivision:GEOID:2705300001",
      "place:GEOID:2743000",
      "state:GEOID:27",
    ]);

    expect(
      locationPaths["county_subdivision:GEOID:2705300001"].spec,
    ).toMatchObject({
      resolution_class: "county_subdivision",
      display_name: "Test township",
    });
    const report = JSON.parse(
      await readFile(path.join(state, "local-jurisdictions-2025.json"), "utf8"),
    );
    expect(report.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ geoid: "2705300001", status: "included" }),
        expect.objectContaining({ geoid: "2705300002", status: "excluded" }),
      ]),
    );
    for (const record of Object.values(locationPaths)) {
      expect(LocationPathSpec.safeParse(record.spec).success).toBe(true);
    }

    expect(locationPaths["state:GEOID:27"].spec).toMatchObject({
      location_path_id: "state:GEOID:27",
      path: "/mn/",
      level: "state",
      display_name: "Minnesota",
      parent_location_path_id: null,
      centroid: { type: "Point", coordinates: [-93.5, 44.5] },
      bbox: {
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
      },
    });
    // latitude/longitude are on the ported LocationPathRow shape but are not
    // part of the target LocationPathSpec — assert they were stripped.
    expect(locationPaths["state:GEOID:27"].spec).not.toHaveProperty("latitude");
    expect(locationPaths["state:GEOID:27"].spec).not.toHaveProperty(
      "longitude",
    );

    expect(locationPaths["administrative_area:GEOID:27053"].spec).toMatchObject(
      {
        location_path_id: "administrative_area:GEOID:27053",
        level: "administrative_area",
        display_name: "Hennepin County",
        parent_location_path_id: "state:GEOID:27",
        centroid: { type: "Point", coordinates: [5, 5] },
      },
    );

    expect(locationPaths["place:GEOID:2743000"].spec).toMatchObject({
      location_path_id: "place:GEOID:2743000",
      level: "place",
      display_name: "Minneapolis",
      parent_location_path_id: "administrative_area:GEOID:27053",
      centroid: { type: "Point", coordinates: [4, 4] },
    });

    expect(locationPaths["place:GEOID:2743000"].spec).not.toHaveProperty(
      "path",
    );
    // --- emitted LocationPathGeometries: one per location path, streamed
    // in lexical path order ---
    const geometryEmits = emitted.filter(
      ([kind]) => kind === "LocationPathGeometries",
    );
    expect(geometryEmits.map(([, key]) => key)).toEqual([
      "administrative_area:GEOID:27053",
      "county_subdivision:GEOID:2705300001",
      "place:GEOID:2743000",
      "state:GEOID:27",
    ]);
    for (const [, key, spec] of geometryEmits) {
      const result = LocationPathGeometrySpec.safeParse(spec);
      expect(result.success).toBe(true);
      expect(spec).toMatchObject({
        location_path_id: key,
        sourceLocationPathKey: key,
        // number, not "2025" — matches the original producer's output vintage
        selectedYear: 2025,
      });
      expect(typeof (spec as { selectedYear: unknown }).selectedYear).toBe(
        "number",
      );
    }
    // Geometry is emitted as an opaque JSON string (parsed once as a scalar on
    // import, not a deep coordinate tree); it round-trips to the source GeoJSON.
    const emittedGeometry = (
      geometryEmits.find(([, key]) => key === "state:GEOID:27")![2] as {
        geometry: unknown;
      }
    ).geometry;
    expect(typeof emittedGeometry).toBe("string");
    expect(JSON.parse(emittedGeometry as string)).toEqual({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [-95, 43],
            [-95, 46],
            [-92, 46],
            [-92, 43],
            [-95, 43],
          ],
        ],
      ],
    });

    // --- envelope build must not throw: proves strict-schema compatibility
    // for every inline (non-streamed) record kind in the manifest ---
    expect(() =>
      buildArtifactsEnvelope("us-census-gazetteer", "test-digest", manifest),
    ).not.toThrow();
  });

  it("is deterministic", async () => {
    const runOnce = async () => {
      const emitted: Array<[string, string, unknown]> = [];
      const emit = async (kind: string, key: string, spec: unknown) => {
        emitted.push([kind, key, spec]);
      };
      const runState = await mkdtemp(
        path.join(tmpdir(), "us-census-gazetteer-run-test-determinism-"),
      );
      try {
        const manifest = await transform({
          paths,
          readXlsx: notUsed,
          state: runState,
          emit,
        });
        return { manifest, emitted };
      } finally {
        await rm(runState, { recursive: true, force: true });
      }
    };

    const first = await runOnce();
    const second = await runOnce();
    expect(second.manifest).toEqual(first.manifest);
    expect(second.emitted).toEqual(first.emitted);
  });
});
