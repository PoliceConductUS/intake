import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { ImportArtifactKind } from "../../src/shared/io/index.js";

export const produces: readonly ImportArtifactKind[] = [
  "LocationPaths",
  "LocationPathAliases",
  "LocationPathGeometries",
];
import type {
  EmittedRecords,
  TransformDeps,
  SourceManifest,
  SourceTransform,
} from "../../src/cli/transform/source-transform.js";
import {
  listZipEntries,
  readZipEntryText,
} from "../../src/cli/transform/parse/zip.js";
import {
  parseGazetteerFile,
  type GazetteerRecordByType,
  type GazetteerRecordType,
} from "./lib/gazetteer-parser.js";
import { parseHierarchyRelationshipFile } from "./lib/hierarchy-parser.js";
import { buildHierarchyFromTiger } from "./lib/tiger-hierarchy.js";
import { buildLocationPaths } from "./lib/location-paths.js";
import type { LocationPathAliasEntry } from "./lib/location-paths.js";
import { buildLocationPathGeometryPackage } from "./lib/location-geometries.js";
import type { LocationPathWithGeometryExtent } from "./lib/location-geometries.js";
import { addSupplementalPlaces } from "./lib/supplemental-places.js";
import {
  readFeaturesByState,
  type TigerFeatureRow,
} from "./lib/tiger-hierarchy.js";
import { matchInputs } from "./lib/inputs.js";

/**
 * Orchestrates the Census `lib/` domain modules into the runtime's
 * manifest+emit contract, mirroring the stage chain in the original
 * standalone producer's `intake.us-census-gazetteer/src/run.js`
 * (`runValidatedCommand`), minus discovery/download/envelope-writing (all
 * out of scope for a `SourceTransform` — the caller handles envelope assembly and
 * writing via `buildArtifactsEnvelope`).
 *
 * Stage chain:
 *   1. `matchInputs` classifies the run's input file paths by role.
 *   2. Each Gazetteer zip's single `.txt` entry is parsed into `states` /
 *      `administrativeAreas` / `places` records.
 *   3. `hierarchy` comes from the (rare) hierarchy/relationship file if one
 *      was supplied, otherwise it's derived from the county+place TIGER
 *      zips via the bbox-prefilter + polygon-clipping intersection engine.
 *   4. `buildLocationPaths` derives the canonical location-path tree (plus
 *      any same-place alternate-administrative-area aliases).
 *   5. Legal county subdivisions and consolidated cities add local places;
 *      retained subdivisions keep their original Census boundaries. A report
 *      records included, fully covered and statistical features.
 *   6. `buildLocationPathGeometryPackage` attaches source/derived geometry,
 *      bbox, and centroid to each location path, streaming each geometry
 *      row to `deps.emit` (the "LocationPathGeometries" kind is the
 *      runtime's one streamed record kind — see `emit-sink.ts`) rather than
 *      holding it all in memory.
 *
 * Record-shape note: `LocationPathWithGeometryExtent` (the ported
 * `pkg.locationPaths` value shape) carries `latitude`/`longitude` fields
 * that the target `LocationPathSpec` (`.strict()`) does not have — that
 * spec instead has `centroid`/`bbox`, which the geometry stage also
 * attaches. `toLocationPathSpec` below picks exactly the spec's fields.
 */
export const description =
  "US Census Gazetteer + TIGER — the canonical location-path tree (state/county/place, including local jurisdictions) with geometry; runs first so other sources resolve against it (ADR 0015).";

export const transform: SourceTransform = async (deps: TransformDeps) => {
  const inputs = matchInputs(deps.paths);

  const states = await readGazetteerZip(inputs.statesZip, "state");
  const administrativeAreas = await readGazetteerZip(
    inputs.adminAreasZip,
    "administrative_area",
  );
  const places = await readGazetteerZip(inputs.placesZip, "place");

  const hierarchy =
    inputs.hierarchyFile === undefined
      ? await buildHierarchyFromTiger({
          countyShapefilePath: inputs.countyTigerZip,
          placeShapefilePaths: inputs.placeTigerZips,
          selectedYear: inputs.year,
          state: deps.state,
        })
      : parseHierarchyRelationshipFile(
          await readFile(inputs.hierarchyFile, "utf8"),
          inputs.year,
        );

  const primary = buildLocationPaths({
    states,
    administrativeAreas,
    places,
    hierarchy,
  });

  const readFeatures = async (
    paths: string[],
    type: Parameters<typeof readFeaturesByState>[1],
  ) => {
    const rows: TigerFeatureRow[] = [];
    for (const file of paths)
      rows.push(
        ...[...(await readFeaturesByState(file, type, deps.state))].flatMap(
          ([, values]) => values,
        ),
      );
    return rows;
  };
  const importedPlaceGeoids = new Set(
    Object.values(primary.locationPathSources)
      .map((e) => e.sourceKey)
      .filter((key) => key.startsWith("place:GEOID:"))
      .map((key) => key.split(":")[2]),
  );
  const supplemental = addSupplementalPlaces({
    built: primary,
    subdivisions: await readFeatures(
      inputs.countySubdivisionTigerZips,
      "county_subdivision",
    ),
    consolidatedCities: await readFeatures(
      inputs.consolidatedCityTigerZips,
      "consolidated_city",
    ),
    places: (await readFeatures(inputs.placeTigerZips, "place")).filter(
      (feature) => importedPlaceGeoids.has(feature.geoid),
    ),
    counties: await readFeatures([inputs.countyTigerZip], "county"),
  });
  const { built } = supplemental;
  await mkdir(deps.state, { recursive: true });
  const reportPath = path.join(
    deps.state,
    `local-jurisdictions-${inputs.year}.json`,
  );
  await writeFile(
    reportPath,
    JSON.stringify(
      { year: inputs.year, records: supplemental.report },
      null,
      2,
    ) + "\n",
  );
  const counts = Object.fromEntries(
    ["included", "covered", "excluded"].map((status) => [
      status,
      supplemental.report.filter((row) => row.status === status).length,
    ]),
  );
  deps.logger?.info(
    `Census local jurisdictions: ${JSON.stringify(counts)}; report ${reportPath}`,
  );

  const pkg = await buildLocationPathGeometryPackage({
    supplementalGeometries: supplemental.geometries,
    locationPaths: built.locationPaths,
    locationPathSources: built.locationPathSources,
    stateGeometryPath: inputs.stateTigerZip,
    countyGeometryPath: inputs.countyTigerZip,
    placeGeometryPaths: inputs.placeTigerZips,
    selectedYear: inputs.year,
    state: deps.state,
    onGeometryRow: async (path, row) => {
      await deps.emit("LocationPathGeometries", path, {
        location_path_id: row.location_path_id,
        // Opaque GeoJSON blob (pass-through to ST_GeomFromGeoJSON): store it as a
        // JSON string so the artifact reader parses one scalar, not a deep
        // coordinate tree — the dominant census-import parse cost (ADR: geometry
        // is never structurally read by intake or the site).
        geometry: JSON.stringify(row.geometry),
        sourceLocationPathKey: path,
        // Emit the vintage as a number to match the original producer's output
        // (selectedYear is `2025`, not `"2025"`); `inputs.year` is parsed from a filename.
        selectedYear: Number(inputs.year),
      });
    },
  });

  const artifacts: SourceManifest["artifacts"] = [
    { kind: "LocationPaths", records: wrapLocationPaths(pkg.locationPaths) },
  ];
  if (Object.keys(built.locationPathAlias).length > 0) {
    artifacts.push({
      kind: "LocationPathAliases",
      records: wrapAliases(built.locationPathAlias),
    });
  }

  return { artifacts };
};

async function readGazetteerZip<T extends GazetteerRecordType>(
  zipPath: string,
  type: T,
): Promise<GazetteerRecordByType[T][]> {
  const entries = await listZipEntries(zipPath);
  const textEntryName = entries.find((entryName) =>
    entryName.toLowerCase().endsWith(".txt"),
  );
  if (textEntryName === undefined) {
    throw new Error(`No .txt entry found in Gazetteer zip: ${zipPath}`);
  }
  const text = await readZipEntryText(zipPath, textEntryName);
  return parseGazetteerFile(text, type);
}

/**
 * Maps the ported `LocationPathWithGeometryExtent` shape (which still
 * carries the original's `latitude`/`longitude` strings) onto exactly the
 * fields the target `LocationPathSpec` (`.strict()`) validates: the same
 * eleven descriptive fields, plus `centroid`/`bbox` in place of
 * `latitude`/`longitude`.
 */
function toLocationPathSpec(row: LocationPathWithGeometryExtent) {
  return {
    location_path_id: row.location_path_id,
    ...(row.level === "state" ? { path: row.path } : {}),
    level: row.level,
    resolution_class: row.resolution_class ?? "primary",
    display_name: row.display_name,
    parent_location_path_id: row.parent_location_path_id,
    centroid: row.centroid,
    bbox: row.bbox,
  };
}

function wrapLocationPaths(
  locationPaths: Record<string, LocationPathWithGeometryExtent>,
): EmittedRecords {
  return Object.fromEntries(
    Object.entries(locationPaths).map(([key, row]) => [
      key,
      { spec: toLocationPathSpec(row) },
    ]),
  );
}

function wrapAliases(
  locationPathAlias: Record<string, LocationPathAliasEntry>,
): EmittedRecords {
  return Object.fromEntries(
    Object.entries(locationPathAlias).map(([key, entry]) => [
      key,
      {
        spec: {
          location_path_id: entry.location_path_id,
          parent_location_path_id: entry.parent_location_path_id,
        },
      },
    ]),
  );
}
