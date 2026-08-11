import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import polygonClipping, {
  type MultiPolygon,
  type Polygon,
  type Ring,
} from "polygon-clipping";
import { readGeoJson, readShapefile } from "../../../src/cli/run/parse/geo.js";
import { allowedStateGeoids, allowedStateSlugs } from "./constants.js";
import { extractShapefileFromZip } from "./extract.js";
import {
  deterministicTotalAreaOverlapRecordSchema,
  type DeterministicTotalAreaOverlapRecord,
} from "./schemas.js";

/**
 * Ported from `intake.census-gazetteer/src/tiger-hierarchy.js`
 * (`buildHierarchyFromTiger`, `readFeaturesByState`, `toClippingGeometry`).
 * The O(places×counties) bbox-prefilter + `polygon-clipping` intersection
 * engine and the final compound-key sort are unchanged from the original —
 * only the three I/O edges below were rewired:
 *
 * 1. Geometry reads: the original read a shapefile via `shapefile.open()`
 *    (or a `.geojson` via `readFile`+`JSON.parse`) given a plain
 *    already-extracted path. The new runtime hands this module TIGER
 *    `.zip` paths directly, so `readFeaturesByState` now extracts
 *    `.shp`/`.dbf`/`.shx` from the zip (via `extractShapefileFromZip`,
 *    which uses the Phase-1 zip helpers) before reading through the
 *    Phase-1 `readShapefile`/`readGeoJson` helpers.
 * 2. Per-state hierarchy cache: the original cached under a caller-supplied
 *    `hierarchyCachePath` rooted in the per-run command directory, which
 *    was wiped between runs — a bug that made the cache never actually
 *    persist. The port caches under `path.join(state, "hierarchy",
 *    "<stateGeoid>.json")`, `state` being the run's persistent state
 *    directory, so completed states really do get reused across runs. The
 *    atomic temp-then-rename write and the cache-hit short-circuit are
 *    unchanged.
 * 3. Logging: the original's `logger`/`progressLogger`/`consoleProgress`/
 *    `progressInterval` parameters and its `logHierarchyProgress` /
 *    `stateProgressFields` / `percent` / `progressBar` support functions
 *    were standalone-producer-CLI progress reporting with no effect on the
 *    derived hierarchy. They are dropped entirely rather than carried as
 *    permanently-unused parameters.
 *
 * `readPlaceCommonNamesByGeoid` from the original file was dead code (no
 * callers anywhere in the original repo, including its tests) and was not
 * ported.
 */

export type TigerFeatureType = "state" | "county" | "place";

interface GeoJsonGeometry {
  type?: string;
  coordinates?: unknown;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TigerFeatureRow {
  geoid: string;
  name: string;
  label: string;
  type: string;
  geometry: GeoJsonGeometry;
  bbox: BBox;
}

export interface BuildHierarchyFromTigerOptions {
  countyShapefilePath: string;
  placeShapefilePaths: string[];
  selectedYear: string;
  state: string;
}

export async function buildHierarchyFromTiger({
  countyShapefilePath,
  placeShapefilePaths,
  selectedYear,
  state,
}: BuildHierarchyFromTigerOptions): Promise<
  DeterministicTotalAreaOverlapRecord[]
> {
  const counties = await readFeaturesByState(
    countyShapefilePath,
    "county",
    state,
  );
  const places = new Map<string, TigerFeatureRow[]>();
  for (const placeShapefilePath of placeShapefilePaths) {
    mergeFeatureMaps(
      places,
      await readFeaturesByState(placeShapefilePath, "place", state),
    );
  }

  const hierarchy: DeterministicTotalAreaOverlapRecord[] = [];

  const stateEntries = [...places.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [stateGeoid, statePlaces] of stateEntries) {
    const stateCounties = counties.get(stateGeoid) ?? [];
    const cachedStateHierarchy = await readCachedStateHierarchy({
      state,
      selectedYear,
      stateGeoid,
    });
    if (cachedStateHierarchy !== undefined) {
      hierarchy.push(...cachedStateHierarchy);
      continue;
    }

    const stateHierarchy: DeterministicTotalAreaOverlapRecord[] = [];
    for (const place of statePlaces) {
      const placeGeometry = toClippingGeometry(place.geometry);
      if (placeGeometry === undefined) continue;
      const placeBox = bboxForGeometry(place.geometry);
      for (const county of stateCounties) {
        if (!boxesIntersect(placeBox, county.bbox)) continue;
        const countyGeometry = toClippingGeometry(county.geometry);
        if (countyGeometry === undefined) continue;
        const intersection = polygonClipping.intersection(
          placeGeometry,
          countyGeometry,
        );
        const overlapTotalArea = Math.round(
          multiPolygonArea(intersection) * 1e12,
        );
        if (overlapTotalArea <= 0) continue;
        const hierarchyRecord = deterministicTotalAreaOverlapRecordSchema.parse(
          {
            stateGeoid,
            administrativeAreaGeoid: county.geoid,
            placeGeoid: place.geoid,
            overlapTotalArea,
            placeName: place.name,
            placeLabel: place.label,
            sourceKey: `us-census-tiger:overlap:${selectedYear}:${stateGeoid}:${county.geoid}:${place.geoid}`,
          },
        );
        hierarchy.push(hierarchyRecord);
        stateHierarchy.push(hierarchyRecord);
      }
    }
    await writeCachedStateHierarchy({
      state,
      selectedYear,
      stateGeoid,
      records: stateHierarchy,
    });
  }

  if (hierarchy.length === 0) {
    throw new Error("No authoritative Census hierarchy source was acquired");
  }

  return hierarchy.sort((left, right) =>
    [
      left.stateGeoid,
      left.placeGeoid,
      left.administrativeAreaGeoid,
      left.sourceKey,
    ]
      .join(":")
      .localeCompare(
        [
          right.stateGeoid,
          right.placeGeoid,
          right.administrativeAreaGeoid,
          right.sourceKey,
        ].join(":"),
      ),
  );
}

export async function readCachedStateHierarchy({
  state,
  selectedYear,
  stateGeoid,
}: {
  state: string;
  selectedYear: string;
  stateGeoid: string;
}): Promise<DeterministicTotalAreaOverlapRecord[] | undefined> {
  const cachePath = stateHierarchyCacheFilePath(state, stateGeoid);
  let parsed: { selectedYear: string; stateGeoid: string; records: unknown[] };
  try {
    parsed = JSON.parse(await readFile(cachePath, "utf8")) as {
      selectedYear: string;
      stateGeoid: string;
      records: unknown[];
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(
      `Unable to read cached hierarchy state artifact: ${cachePath}`,
      {
        cause: error,
      },
    );
  }

  if (
    parsed.selectedYear !== selectedYear ||
    parsed.stateGeoid !== stateGeoid
  ) {
    throw new Error(
      `Cached hierarchy state artifact does not match run: ${cachePath}`,
    );
  }

  return parsed.records.map((record) =>
    deterministicTotalAreaOverlapRecordSchema.parse(record),
  );
}

export async function writeCachedStateHierarchy({
  state,
  selectedYear,
  stateGeoid,
  records,
}: {
  state: string;
  selectedYear: string;
  stateGeoid: string;
  records: DeterministicTotalAreaOverlapRecord[];
}): Promise<void> {
  const cacheDir = path.join(state, "hierarchy");
  await mkdir(cacheDir, { recursive: true });
  const cachePath = stateHierarchyCacheFilePath(state, stateGeoid);
  const temporaryPath = `${cachePath}.tmp-${process.pid}`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(
      {
        selectedYear,
        stateGeoid,
        records,
      },
      null,
      2,
    )}\n`,
  );
  await rename(temporaryPath, cachePath);
}

function stateHierarchyCacheFilePath(
  state: string,
  stateGeoid: string,
): string {
  return path.join(state, "hierarchy", `${stateGeoid}.json`);
}

function mergeFeatureMaps(
  target: Map<string, TigerFeatureRow[]>,
  source: Map<string, TigerFeatureRow[]>,
): void {
  for (const [stateGeoid, features] of source) {
    const existing = target.get(stateGeoid) ?? [];
    existing.push(...features);
    target.set(stateGeoid, existing);
  }
}

export async function readFeaturesByState(
  geometryPath: string,
  type: TigerFeatureType,
  state: string,
): Promise<Map<string, TigerFeatureRow[]>> {
  if (geometryPath.toLowerCase().endsWith(".geojson")) {
    return readGeoJsonFeaturesByState(geometryPath, type);
  }

  const shpPath = geometryPath.toLowerCase().endsWith(".zip")
    ? await extractShapefileFromZip(geometryPath, state)
    : geometryPath;

  const featuresByState = new Map<string, TigerFeatureRow[]>();
  for await (const feature of readShapefile(shpPath)) {
    const properties = feature.properties ?? {};
    const stateGeoid = properties.STATEFP as string;
    if (!allowedStateGeoids.has(stateGeoid)) continue;
    const stateSlug = (properties.STUSPS as string | undefined)?.toLowerCase();
    if (stateSlug !== undefined && !allowedStateSlugs.has(stateSlug)) continue;
    const geoid = featureGeoid(properties, type);
    if (typeof geoid !== "string") continue;

    const records = featuresByState.get(stateGeoid) ?? [];
    records.push({
      geoid,
      name: properties.NAME as string,
      label:
        (properties.NAMELSAD as string | undefined) ??
        (properties.NAME as string),
      type: properties.LSAD as string,
      geometry: feature.geometry as GeoJsonGeometry,
      bbox: bboxForGeometry(feature.geometry as GeoJsonGeometry),
    });
    featuresByState.set(stateGeoid, records);
  }

  return featuresByState;
}

async function readGeoJsonFeaturesByState(
  geometryPath: string,
  type: TigerFeatureType,
): Promise<Map<string, TigerFeatureRow[]>> {
  const features = await readGeoJson(geometryPath);
  const featuresByState = new Map<string, TigerFeatureRow[]>();
  for (const feature of features) {
    addFeatureByState(featuresByState, feature, type);
  }
  return featuresByState;
}

function addFeatureByState(
  featuresByState: Map<string, TigerFeatureRow[]>,
  feature: { properties: Record<string, unknown>; geometry: unknown },
  type: TigerFeatureType,
): void {
  const properties = feature.properties ?? {};
  const stateGeoid = properties.STATEFP as string;
  if (!allowedStateGeoids.has(stateGeoid)) return;
  const stateSlug = (properties.STUSPS as string | undefined)?.toLowerCase();
  if (stateSlug !== undefined && !allowedStateSlugs.has(stateSlug)) return;
  const geoid = featureGeoid(properties, type);
  if (typeof geoid !== "string") return;

  const records = featuresByState.get(stateGeoid) ?? [];
  records.push({
    geoid,
    name: properties.NAME as string,
    label:
      (properties.NAMELSAD as string | undefined) ??
      (properties.NAME as string),
    type: properties.LSAD as string,
    geometry: feature.geometry as GeoJsonGeometry,
    bbox: bboxForGeometry(feature.geometry as GeoJsonGeometry),
  });
  featuresByState.set(stateGeoid, records);
}

function featureGeoid(
  properties: Record<string, unknown>,
  type: TigerFeatureType,
): string | undefined {
  if (type === "state") {
    return (
      (properties.GEOID as string | undefined) ??
      (properties.STATEFP as string | undefined)
    );
  }
  if (type === "county") return properties.GEOID as string | undefined;
  return (
    (properties.GEOID as string | undefined) ??
    `${properties.STATEFP as string}${properties.PLACEFP as string}`
  );
}

export function toClippingGeometry(
  geometry: GeoJsonGeometry | undefined,
): MultiPolygon | undefined {
  if (geometry?.type === "Polygon") return [geometry.coordinates as Polygon];
  if (geometry?.type === "MultiPolygon")
    return geometry.coordinates as MultiPolygon;
  return undefined;
}

function bboxForGeometry(geometry: GeoJsonGeometry | undefined): BBox {
  const coordinates: [number, number][] = [];
  collectCoordinates(geometry?.coordinates, coordinates);
  const xs = coordinates.map(([x]) => x);
  const ys = coordinates.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function collectCoordinates(
  value: unknown,
  coordinates: [number, number][],
): void {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    coordinates.push(value as [number, number]);
    return;
  }
  for (const child of value as unknown[])
    collectCoordinates(child, coordinates);
}

function boxesIntersect(left: BBox, right: BBox): boolean {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  );
}

function multiPolygonArea(multiPolygon: MultiPolygon): number {
  return multiPolygon.reduce((sum, polygon) => sum + polygonArea(polygon), 0);
}

function polygonArea(polygon: Polygon): number {
  return polygon.reduce((sum, ring, index) => {
    const area = Math.abs(ringArea(ring));
    return index === 0 ? sum + area : sum - area;
  }, 0);
}

function ringArea(ring: Ring): number {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}
