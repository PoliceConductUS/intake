import polygonClipping, { type MultiPolygon } from "polygon-clipping";
import {
  slugFromSourceName,
  type BuildLocationPathsResult,
} from "./location-paths.js";
import {
  multiPolygonArea,
  toClippingGeometry,
  type TigerFeatureRow,
} from "./tiger-hierarchy.js";
import type { LocationPathGeometry } from "./location-geometries.js";

// Census CLASSFP definitions: https://www.census.gov/library/reference/code-lists/class-codes.html
const LOCAL_CLASSES = new Set([
  "C2",
  "C5",
  "C7",
  "S1",
  "T1",
  "T2",
  "T5",
  "T9",
  "Z1",
  "Z2",
  "Z7",
]);
const EXCLUDED_CLASSES = new Set(["S2", "S3", "Z3", "Z5", "Z9"]);
export interface SupplementalPlaceReport {
  geoid: string;
  name: string;
  classCode: string;
  sourceType: "county_subdivision" | "consolidated_city";
  status: "included" | "clipped" | "covered" | "excluded";
  reason: string;
  path?: string;
}

function polygon(feature: TigerFeatureRow): MultiPolygon {
  const geometry = toClippingGeometry(feature.geometry);
  if (!geometry?.length)
    throw new Error(
      `Missing Census polygon for ${feature.geoid} ${feature.label}`,
    );
  return geometry;
}
function intersects(a: TigerFeatureRow, b: TigerFeatureRow): boolean {
  return (
    a.bbox.minX <= b.bbox.maxX &&
    a.bbox.maxX >= b.bbox.minX &&
    a.bbox.minY <= b.bbox.maxY &&
    a.bbox.maxY >= b.bbox.minY
  );
}

/** Pure derivation; original source polygons are never modified. */
export function addSupplementalPlaces(input: {
  built: BuildLocationPathsResult;
  subdivisions: TigerFeatureRow[];
  consolidatedCities: TigerFeatureRow[];
  places: TigerFeatureRow[];
  counties: TigerFeatureRow[];
}): {
  built: BuildLocationPathsResult;
  geometries: Map<string, LocationPathGeometry>;
  report: SupplementalPlaceReport[];
} {
  const built = {
    ...input.built,
    locationPaths: { ...input.built.locationPaths },
    locationPathSources: { ...input.built.locationPathSources },
    locationPathAlias: { ...input.built.locationPathAlias },
    locationPathAliasSources: { ...input.built.locationPathAliasSources },
  };
  const countyPaths = new Map(
    Object.entries(built.locationPathSources)
      .filter(([, evidence]) =>
        evidence.sourceKey.startsWith("administrative_area:GEOID:"),
      )
      .map(([path, evidence]) => [evidence.sourceKey.split(":")[2], path]),
  );
  const geometries = new Map<string, LocationPathGeometry>();
  const report: SupplementalPlaceReport[] = [];
  const seen = new Set<string>();
  for (const [sourceType, features] of [
    ["county_subdivision", input.subdivisions],
    ["consolidated_city", input.consolidatedCities],
  ] as const) {
    for (const feature of [...features].sort((a, b) =>
      a.geoid.localeCompare(b.geoid),
    )) {
      const sourceKey = `${sourceType}:GEOID:${feature.geoid}`;
      if (seen.has(sourceKey))
        throw new Error(`Duplicate Census source ${sourceKey}`);
      seen.add(sourceKey);
      const classCode = String(feature.properties?.CLASSFP ?? "");
      const entry: SupplementalPlaceReport = {
        geoid: feature.geoid,
        name: feature.label,
        classCode,
        sourceType,
        status: "included",
        reason: "Census local jurisdiction",
      };
      report.push(entry);
      if (
        sourceType === "county_subdivision" &&
        EXCLUDED_CLASSES.has(classCode)
      ) {
        entry.status = "excluded";
        entry.reason = "Statistical, unorganized, or undefined subdivision";
        continue;
      }
      if (
        sourceType === "county_subdivision"
          ? !LOCAL_CLASSES.has(classCode)
          : classCode !== "C3"
      )
        throw new Error(
          `Unsupported Census ${sourceType} class ${classCode} for ${feature.geoid}`,
        );
      if (
        !(sourceType === "county_subdivision" ? /^\d{10}$/ : /^\d{7}$/).test(
          feature.geoid,
        )
      )
        throw new Error(`Invalid ${sourceType} GEOID ${feature.geoid}`);
      const stateGeoid = String(feature.properties?.STATEFP ?? "");
      if (stateGeoid !== feature.geoid.slice(0, 2))
        throw new Error(`Mismatched Census state for ${sourceKey}`);
      let coordinates = polygon(feature);
      let parents: { path: string; overlap: number }[];
      if (sourceType === "county_subdivision") {
        const countyGeoid = `${stateGeoid}${String(feature.properties?.COUNTYFP ?? "")}`;
        const countyPath = countyPaths.get(countyGeoid);
        if (!countyPath || countyGeoid !== feature.geoid.slice(0, 5))
          throw new Error(
            `Missing or inconsistent authoritative county ${countyGeoid} for ${sourceKey}`,
          );
        parents = [{ path: countyPath, overlap: 0 }];
        const covering = input.places
          .filter(
            (place) =>
              place.geoid.startsWith(stateGeoid) && intersects(feature, place),
          )
          .map(polygon);
        if (covering.length) {
          const uncovered = polygonClipping.difference(
            coordinates,
            ...covering,
          );
          if (!uncovered.length) {
            entry.status = "covered";
            entry.reason =
              "Fully covered by the union of Census PLACE boundaries";
            continue;
          }
          if (multiPolygonArea(uncovered) < multiPolygonArea(coordinates)) {
            entry.status = "clipped";
            entry.reason =
              "Site boundary excludes Census PLACE coverage; original TIGER source retained";
          }
          coordinates = uncovered;
        }
      } else {
        parents = input.counties
          .filter(
            (county) =>
              county.geoid.startsWith(stateGeoid) &&
              intersects(feature, county),
          )
          .map((county) => ({
            path: countyPaths.get(county.geoid),
            overlap: multiPolygonArea(
              polygonClipping.intersection(coordinates, polygon(county)),
            ),
          }))
          .filter(
            (item): item is { path: string; overlap: number } =>
              item.path !== undefined && item.overlap > 0,
          )
          .sort(
            (a, b) => b.overlap - a.overlap || a.path.localeCompare(b.path),
          );
        if (!parents.length)
          throw new Error(
            `Missing Census county intersection for ${sourceKey}`,
          );
      }
      const name = feature.label.trim();
      if (!name) throw new Error(`Missing Census name for ${sourceKey}`);
      const suffix = slugFromSourceName(name);
      const parent = parents[0].path;
      const path = `${parent}${suffix}/`;
      if (built.locationPaths[path] || built.locationPathAlias[path])
        throw new Error(
          `Supplemental Census path collision ${path} (${sourceKey})`,
        );
      entry.path = path;
      built.locationPaths[path] = {
        location_path_id: path,
        path,
        level: "place",
        display_name: name,
        parent_location_path_id: parent,
        latitude: "0",
        longitude: "0",
        resolution_class: sourceType,
      };
      built.locationPathSources[path] = {
        sourceKey,
        parentSourceKey: built.locationPathSources[parent].sourceKey,
      };
      geometries.set(path, { type: "MultiPolygon", coordinates });
      for (const alternate of parents.slice(1)) {
        const alias = `${alternate.path}${suffix}/`;
        if (built.locationPaths[alias] || built.locationPathAlias[alias])
          throw new Error(`Supplemental Census alias collision ${alias}`);
        built.locationPathAlias[alias] = {
          alias_path: alias,
          location_path_id: path,
        };
        built.locationPathAliasSources[alias] = { sourceKey };
      }
    }
  }
  return { built, geometries, report };
}
