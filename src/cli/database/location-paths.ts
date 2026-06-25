import type { DatabaseClient } from "./index.js";
import {
  locationPathBboxGeoJson,
  locationPathCentroidGeoJson,
  type LocationPathBbox,
  type LocationPathCentroid,
} from "./location-path-spatial.js";

export type DatabaseLocationPathRow = {
  location_path_id: string;
  path: string;
  level: "state" | "administrative_area" | "place";
  state_or_territory_slug: string;
  administrative_area_slug: string | null;
  place_slug: string | null;
  state_or_territory_name: string;
  administrative_area_name: string | null;
  place_name: string | null;
  parent_location_path_id: string | null;
  centroid?: LocationPathCentroid | null;
  bbox?: LocationPathBbox | null;
};

export type DatabaseLocationPathAliasRow = {
  alias_path: string;
  location_path_id: string;
};

function rowsFromResult(
  result: { rows?: Record<string, unknown>[] } | unknown,
): Record<string, unknown>[] {
  return typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray(result.rows)
    ? result.rows
    : [];
}

function firstRow<T>(result: unknown): T | undefined {
  return rowsFromResult(result)[0] as T | undefined;
}

export async function readLocationPaths(
  client: DatabaseClient,
): Promise<DatabaseLocationPathRow[]> {
  return rowsFromResult(
    await client.query(
      `select location_path_id,
              path,
              level,
              state_or_territory_slug,
              administrative_area_slug,
              place_slug,
              state_or_territory_name,
              administrative_area_name,
              place_name,
              parent_location_path_id,
              case
                when centroid is null then null
                else ST_AsGeoJSON(centroid::geometry)::jsonb
              end as centroid,
              case
                when bbox is null then null
                else ST_AsGeoJSON(bbox)::jsonb
              end as bbox
         from public.location_path`,
    ),
  ) as unknown as DatabaseLocationPathRow[];
}

export async function readLocationPathAliases(
  client: DatabaseClient,
): Promise<DatabaseLocationPathAliasRow[]> {
  return rowsFromResult(
    await client.query(
      `select alias_path,
              location_path_id
         from public.location_path_alias`,
    ),
  ) as unknown as DatabaseLocationPathAliasRow[];
}

export async function readLocationPathById(
  client: DatabaseClient,
  locationPathId: string,
): Promise<DatabaseLocationPathRow | undefined> {
  return firstRow<DatabaseLocationPathRow>(
    await client.query(
      `select location_path_id, path, level, state_or_territory_slug,
              administrative_area_slug, place_slug, state_or_territory_name,
              administrative_area_name, place_name, parent_location_path_id
         from public.location_path
        where location_path_id = $1`,
      [locationPathId],
    ),
  );
}

export async function readLocationPathByPath(
  client: DatabaseClient,
  locationPathPath: string,
): Promise<DatabaseLocationPathRow | undefined> {
  return firstRow<DatabaseLocationPathRow>(
    await client.query(
      `select location_path_id, path, level, state_or_territory_slug,
              administrative_area_slug, place_slug, state_or_territory_name,
              administrative_area_name, place_name, parent_location_path_id
         from public.location_path
        where path = $1`,
      [locationPathPath],
    ),
  );
}

export async function readLocationPathByIdOrPath(
  client: DatabaseClient,
  input: { locationPathId: string; path: string },
): Promise<DatabaseLocationPathRow | undefined> {
  return firstRow<DatabaseLocationPathRow>(
    await client.query(
      "select * from public.location_path where location_path_id = $1 or path = $2",
      [input.locationPathId, input.path],
    ),
  );
}

export async function readLocationPathAliasByPath(
  client: DatabaseClient,
  aliasPath: string,
): Promise<DatabaseLocationPathAliasRow | undefined> {
  return firstRow<DatabaseLocationPathAliasRow>(
    await client.query(
      "select * from public.location_path_alias where alias_path = $1",
      [aliasPath],
    ),
  );
}

export async function readPlaceLocationPathsContainingPoint(
  client: DatabaseClient,
  input: { latitude: number; longitude: number },
): Promise<DatabaseLocationPathRow[]> {
  return rowsFromResult(
    await client.query(
      `select lp.location_path_id,
              lp.path,
              lp.level,
              lp.state_or_territory_slug,
              lp.administrative_area_slug,
              lp.place_slug,
              lp.state_or_territory_name,
              lp.administrative_area_name,
              lp.place_name,
              lp.parent_location_path_id,
              case
                when lp.centroid is null then null
                else ST_AsGeoJSON(lp.centroid::geometry)::jsonb
              end as centroid,
              case
                when lp.bbox is null then null
                else ST_AsGeoJSON(lp.bbox)::jsonb
              end as bbox
         from public.location_path lp
         join public.location_path_geometry lpg
           on lpg.location_path_id = lp.location_path_id
        where lp.level = 'place'
          and ST_Covers(lpg.boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))`,
      [input.longitude, input.latitude],
    ),
  ) as unknown as DatabaseLocationPathRow[];
}

export async function createLocationPath(
  client: DatabaseClient,
  locationPath: DatabaseLocationPathRow,
): Promise<void> {
  await client.query(
    `insert into public.location_path (
      location_path_id,
      path,
      level,
      state_or_territory_slug,
      administrative_area_slug,
      place_slug,
      state_or_territory_name,
      administrative_area_name,
      place_name,
      parent_location_path_id,
      centroid,
      bbox
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      ST_SetSRID(ST_GeomFromGeoJSON($11), 4326)::geography,
      ST_SetSRID(ST_GeomFromGeoJSON($12), 4326)
    )`,
    [
      locationPath.location_path_id,
      locationPath.path,
      locationPath.level,
      locationPath.state_or_territory_slug,
      locationPath.administrative_area_slug,
      locationPath.place_slug,
      locationPath.state_or_territory_name,
      locationPath.administrative_area_name,
      locationPath.place_name,
      locationPath.parent_location_path_id,
      locationPathCentroidGeoJson(locationPath.centroid),
      locationPathBboxGeoJson(locationPath.bbox),
    ],
  );
}

export async function createLocationPathAlias(
  client: DatabaseClient,
  locationPathAlias: DatabaseLocationPathAliasRow,
): Promise<void> {
  await client.query(
    `insert into public.location_path_alias (
      alias_path,
      location_path_id
    ) values ($1, $2)`,
    [locationPathAlias.alias_path, locationPathAlias.location_path_id],
  );
}
