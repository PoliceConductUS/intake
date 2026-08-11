import type { MultiPolygon } from "polygon-clipping";
import type { LocationPathRow, LocationPathSourceEvidence } from "./location-paths.js";
import { readFeaturesByState, toClippingGeometry, type TigerFeatureRow } from "./tiger-hierarchy.js";

/**
 * Ported from `intake.census-gazetteer/src/location-geometries.js`
 * (`buildLocationPathGeometries`, `buildLocationPathGeometryPackage`).
 *
 * The geometry/bbox/centroid math, the `sortedObject()` lexical sorting, and
 * the lexical `locationPathEntries` emit order (which the `onGeometryRow`
 * streaming seam depends on) are unchanged from the original. Two changes:
 *
 * 1. I/O rewire: `readFeaturesByState`/`toClippingGeometry` are reused from
 *    `tiger-hierarchy.ts` (Phase-2 Task 4) rather than re-implemented here.
 *    Those now take the run's persistent `state` directory (for TIGER `.zip`
 *    extraction), so this module gained the same `state` parameter and
 *    threads it through unchanged.
 * 2. The `locationPathSourceCache` bbox/centroid perf cache — and its
 *    `matchingCachedLocationPathResolution` short-circuit — was dropped per
 *    the migration decision: bbox/centroid are always recomputed now. This
 *    has no output difference (the cache only ever held previously-computed
 *    values for an unchanged source key), only a performance cost. The
 *    separate `locationPathGeometrySources` map (source-key bookkeeping,
 *    unrelated to the perf cache) is unchanged.
 */

export interface LocationPathGeometry {
  type: "MultiPolygon";
  coordinates: MultiPolygon;
}

export interface LocationPathGeometryRow {
  location_path_id: string;
  geometry: LocationPathGeometry;
}

export interface LocationPathBBox {
  type: "Polygon";
  coordinates: [[number, number][]];
}

export interface LocationPathCentroid {
  type: "Point";
  coordinates: [number, number];
}

export type LocationPathWithGeometryExtent = LocationPathRow & {
  bbox: LocationPathBBox;
  centroid: LocationPathCentroid;
};

export interface LocationPathGeometrySourceEvidence {
  sourceKey: string;
  sourceLocationPathKey: string;
  sourceLocationPathKeys?: string[];
  sourceGeometryKey: string;
  sourceGeometryKeys?: string[];
  selectedYear: number | string;
}

export interface BuildLocationPathGeometryPackageOptions {
  locationPaths: Record<string, LocationPathRow>;
  locationPathSources?: Record<string, LocationPathSourceEvidence>;
  stateGeometryPath: string;
  countyGeometryPath: string;
  placeGeometryPaths: string[];
  selectedYear: number | string;
  state: string;
  onGeometryRow?: (
    path: string,
    row: LocationPathGeometryRow,
  ) => void | Promise<void>;
}

export interface BuildLocationPathGeometryPackageResult {
  locationPaths: Record<string, LocationPathWithGeometryExtent>;
  locationPathGeometrySources: Record<string, LocationPathGeometrySourceEvidence>;
  locationPathGeometries?: Record<string, LocationPathGeometryRow>;
  locationPathGeometryCount: number;
}

export interface BuildLocationPathGeometriesOptions {
  locationPaths: Record<string, LocationPathRow>;
  locationPathSources?: Record<string, LocationPathSourceEvidence>;
  stateGeometryPath: string;
  countyGeometryPath: string;
  placeGeometryPaths: string[];
  selectedYear: number | string;
  state: string;
}

export async function buildLocationPathGeometries(
  options: BuildLocationPathGeometriesOptions,
): Promise<Record<string, LocationPathGeometryRow> | undefined> {
  return (await buildLocationPathGeometryPackage(options)).locationPathGeometries;
}

export async function buildLocationPathGeometryPackage({
  locationPaths,
  locationPathSources = {},
  stateGeometryPath,
  countyGeometryPath,
  placeGeometryPaths,
  selectedYear,
  state,
  onGeometryRow,
}: BuildLocationPathGeometryPackageOptions): Promise<BuildLocationPathGeometryPackageResult> {
  const statesByState = await readFeaturesByState(stateGeometryPath, "state", state);
  const countiesByState = await readFeaturesByState(countyGeometryPath, "county", state);
  const placesByState = new Map<string, TigerFeatureRow[]>();
  for (const placeGeometryPath of placeGeometryPaths) {
    mergeFeatureMaps(placesByState, await readFeaturesByState(placeGeometryPath, "place", state));
  }

  const statesByGeoid = indexFeaturesByGeoid(statesByState);
  const countiesByGeoid = indexFeaturesByGeoid(countiesByState);
  const placesByGeoid = indexFeaturesByGeoid(placesByState);
  const geometryRows =
    onGeometryRow === undefined ? new Map<string, LocationPathGeometryRow>() : undefined;
  const geometrySourceRows = new Map<string, LocationPathGeometrySourceEvidence>();
  const locationPathRows = new Map<string, LocationPathWithGeometryExtent>();
  let locationPathGeometryCount = 0;

  const locationPathEntries = Object.entries(locationPaths).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [path, locationPath] of locationPathEntries) {
    const sourceRecord = locationPathSources[path];
    const source = sourceKeyParts(sourceRecord?.sourceKey);
    if (source === undefined) {
      throw new Error(`Missing source key for location path geometry ${path}`);
    }
    const sources = sourceKeysForGeometry(sourceRecord, source);

    const geometry = geometryForLocationPath({
      locationPath,
      source,
      sources,
      statesByGeoid,
      countiesByGeoid,
      placesByGeoid,
    });
    const geometryRow: LocationPathGeometryRow = {
      location_path_id: locationPath.location_path_id,
      geometry,
    };
    geometrySourceRows.set(path, {
      sourceKey:
        sources.length === 1
          ? `geometry:${source.type}:GEOID:${source.geoid}`
          : `geometry:${source.type}:GEOID:${sources.map((item) => item.geoid).join("+")}`,
      sourceLocationPathKey: path,
      sourceLocationPathKeys: sources.length === 1 ? undefined : [path],
      sourceGeometryKey: sourceRecord!.sourceKey,
      sourceGeometryKeys:
        sources.length === 1 ? undefined : sources.map((item) => `${item.type}:GEOID:${item.geoid}`),
      selectedYear,
    });
    if (onGeometryRow === undefined) {
      geometryRows!.set(path, geometryRow);
    } else {
      await onGeometryRow(path, geometryRow);
    }
    locationPathGeometryCount += 1;
    locationPathRows.set(path, {
      ...locationPath,
      bbox: bboxPolygonForMultiPolygon(geometry.coordinates),
      centroid: centroidPointForMultiPolygon(geometry.coordinates),
    });
  }

  return {
    locationPaths: sortedObject(locationPathRows),
    locationPathGeometrySources: sortedObject(geometrySourceRows),
    locationPathGeometries: geometryRows === undefined ? undefined : sortedObject(geometryRows),
    locationPathGeometryCount,
  };
}

interface SourceKeyParts {
  type: "state" | "administrative_area" | "place";
  geoid: string;
}

function geometryForLocationPath({
  locationPath,
  source,
  sources,
  statesByGeoid,
  countiesByGeoid,
  placesByGeoid,
}: {
  locationPath: LocationPathRow;
  source: SourceKeyParts;
  sources: SourceKeyParts[];
  statesByGeoid: Map<string, TigerFeatureRow>;
  countiesByGeoid: Map<string, TigerFeatureRow>;
  placesByGeoid: Map<string, TigerFeatureRow>;
}): LocationPathGeometry {
  if (locationPath.level === "state") {
    const feature = statesByGeoid.get(source.geoid);
    if (feature === undefined) {
      throw new Error(`Missing TIGER state geometry for ${locationPath.location_path_id}`);
    }
    return toMultiPolygonGeometry(feature.geometry);
  }

  if (locationPath.level === "administrative_area") {
    const feature = countiesByGeoid.get(source.geoid);
    if (feature === undefined) {
      throw new Error(
        `Missing TIGER administrative-area geometry for ${locationPath.location_path_id}`,
      );
    }
    return toMultiPolygonGeometry(feature.geometry);
  }

  if (locationPath.level === "place") {
    const geometries = sources.map((item) => {
      const feature = placesByGeoid.get(item.geoid);
      if (feature === undefined) {
        throw new Error(`Missing TIGER place geometry for ${locationPath.location_path_id}`);
      }
      return toMultiPolygonGeometry(feature.geometry).coordinates;
    });
    return {
      type: "MultiPolygon",
      coordinates: geometries.flat(),
    };
  }

  throw new Error(`Unsupported location path level: ${locationPath.level as string}`);
}

function toMultiPolygonGeometry(
  geometry: Parameters<typeof toClippingGeometry>[0],
): LocationPathGeometry {
  const coordinates = toClippingGeometry(geometry);
  if (coordinates === undefined) {
    throw new Error(`Unsupported TIGER geometry type: ${geometry?.type}`);
  }
  return {
    type: "MultiPolygon",
    coordinates,
  };
}

function formatCoordinate(value: number): number {
  return Number(value.toFixed(12));
}

function bboxPolygonForMultiPolygon(multiPolygon: MultiPolygon): LocationPathBBox {
  const bbox = bboxForMultiPolygon(multiPolygon);
  return {
    type: "Polygon",
    coordinates: [
      [
        [formatCoordinate(bbox.minX), formatCoordinate(bbox.minY)],
        [formatCoordinate(bbox.maxX), formatCoordinate(bbox.minY)],
        [formatCoordinate(bbox.maxX), formatCoordinate(bbox.maxY)],
        [formatCoordinate(bbox.minX), formatCoordinate(bbox.maxY)],
        [formatCoordinate(bbox.minX), formatCoordinate(bbox.minY)],
      ],
    ],
  };
}

function centroidPointForMultiPolygon(multiPolygon: MultiPolygon): LocationPathCentroid {
  const centroid = centroidForMultiPolygon(multiPolygon);
  return {
    type: "Point",
    coordinates: [formatCoordinate(centroid.x), formatCoordinate(centroid.y)],
  };
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bboxForMultiPolygon(multiPolygon: MultiPolygon): BBox {
  const coordinates: [number, number][] = [];
  collectCoordinates(multiPolygon, coordinates);
  const xs = coordinates.map(([x]) => x);
  const ys = coordinates.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

interface WeightedCentroid {
  x: number;
  y: number;
}

function centroidForMultiPolygon(multiPolygon: MultiPolygon): WeightedCentroid {
  let weightedX = 0;
  let weightedY = 0;
  let totalArea = 0;

  for (const polygon of multiPolygon) {
    const centroid = centroidForPolygon(polygon);
    weightedX += centroid.x * centroid.area;
    weightedY += centroid.y * centroid.area;
    totalArea += centroid.area;
  }

  if (totalArea === 0) {
    const bbox = bboxForMultiPolygon(multiPolygon);
    return {
      x: (bbox.minX + bbox.maxX) / 2,
      y: (bbox.minY + bbox.maxY) / 2,
    };
  }

  return {
    x: weightedX / totalArea,
    y: weightedY / totalArea,
  };
}

interface RingCentroid {
  x: number;
  y: number;
  area: number;
}

function centroidForPolygon(polygon: MultiPolygon[number]): RingCentroid {
  let weightedX = 0;
  let weightedY = 0;
  let totalArea = 0;

  for (const [index, ring] of polygon.entries()) {
    const centroid = centroidForRing(ring);
    const signedArea = index === 0 ? Math.abs(centroid.area) : -Math.abs(centroid.area);
    weightedX += centroid.x * signedArea;
    weightedY += centroid.y * signedArea;
    totalArea += signedArea;
  }

  if (totalArea === 0) return { x: polygon[0][0][0], y: polygon[0][0][1], area: 0 };
  return {
    x: weightedX / totalArea,
    y: weightedY / totalArea,
    area: Math.abs(totalArea),
  };
}

function centroidForRing(ring: MultiPolygon[number][number]): RingCentroid {
  let areaFactor = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const cross = x1 * y2 - x2 * y1;
    areaFactor += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }
  const area = areaFactor / 2;
  if (area === 0) return { x: ring[0][0], y: ring[0][1], area: 0 };
  return {
    x: x / (6 * area),
    y: y / (6 * area),
    area,
  };
}

function collectCoordinates(value: unknown, coordinates: [number, number][]): void {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    coordinates.push(value as [number, number]);
    return;
  }
  for (const child of value as unknown[]) collectCoordinates(child, coordinates);
}

function sortedObject<T>(map: Map<string, T>): Record<string, T> {
  return Object.fromEntries(
    [...map.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function indexFeaturesByGeoid(
  featuresByState: Map<string, TigerFeatureRow[]>,
): Map<string, TigerFeatureRow> {
  const featuresByGeoid = new Map<string, TigerFeatureRow>();
  for (const features of featuresByState.values()) {
    for (const feature of features) {
      if (featuresByGeoid.has(feature.geoid)) {
        throw new Error(`Duplicate TIGER geometry GEOID ${feature.geoid}`);
      }
      featuresByGeoid.set(feature.geoid, feature);
    }
  }
  return featuresByGeoid;
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

function sourceKeyParts(sourceKey: string | undefined): SourceKeyParts | undefined {
  const match = /^(?<type>state|administrative_area|place):GEOID:(?<geoid>\d+)$/.exec(
    sourceKey ?? "",
  );
  return match?.groups as SourceKeyParts | undefined;
}

function sourceKeysForGeometry(
  sourceRecord: LocationPathSourceEvidence | undefined,
  fallbackSource: SourceKeyParts,
): SourceKeyParts[] {
  if (!Array.isArray(sourceRecord?.sourceKeys)) return [fallbackSource];
  const sources = sourceRecord.sourceKeys
    .map(sourceKeyParts)
    .filter((value): value is SourceKeyParts => value !== undefined);
  return sources.length === 0 ? [fallbackSource] : sources;
}
