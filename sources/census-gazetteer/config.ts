import { readFile } from "node:fs/promises";
import type {
  EmittedRecords,
  RunDeps,
  SourceManifest,
  SourceRun,
} from "../../src/cli/run/source-run.js";
import { listZipEntries, readZipEntryText } from "../../src/cli/run/parse/zip.js";
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
import { matchInputs } from "./lib/inputs.js";

/**
 * Orchestrates the six ported `lib/` domain modules into the runtime's
 * manifest+emit contract, mirroring the stage chain in the original
 * standalone producer's `intake.census-gazetteer/src/run.js`
 * (`runValidatedCommand`), minus discovery/download/envelope-writing (all
 * out of scope for a `SourceRun` — the caller handles envelope assembly and
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
 *   5. `buildLocationPathGeometryPackage` attaches TIGER polygon geometry,
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
export const run: SourceRun = async (deps: RunDeps) => {
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

  const built = buildLocationPaths({
    states,
    administrativeAreas,
    places,
    hierarchy,
  });

  const pkg = await buildLocationPathGeometryPackage({
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
        geometry: row.geometry,
        sourceLocationPathKey: path,
        selectedYear: inputs.year,
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
    path: row.path,
    level: row.level,
    state_or_territory_slug: row.state_or_territory_slug,
    administrative_area_slug: row.administrative_area_slug,
    place_slug: row.place_slug,
    state_or_territory_name: row.state_or_territory_name,
    administrative_area_name: row.administrative_area_name,
    place_name: row.place_name,
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
      { spec: { alias_path: entry.alias_path, location_path_id: entry.location_path_id } },
    ]),
  );
}
