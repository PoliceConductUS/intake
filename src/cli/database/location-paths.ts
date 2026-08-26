import type { DatabaseClient } from "./index.js";
import type {
  LocationPathRow,
  LocationPathAliasRow,
} from "../../shared/io/generated/entity-specs.js";

export type DatabaseLocationPathRow = LocationPathRow;
export type DatabaseLocationPathAliasRow = LocationPathAliasRow;

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

export async function readLocationPathById(
  client: DatabaseClient,
  locationPathId: string,
): Promise<DatabaseLocationPathRow | undefined> {
  return firstRow<DatabaseLocationPathRow>(
    await client.query(
      `select location_path_id, path, level, state_or_territory_slug,
              administrative_area_slug, place_slug, state_or_territory_name,
              administrative_area_name, place_name, parent_location_path_id,
              centroid, bbox
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
              administrative_area_name, place_name, parent_location_path_id,
              centroid, bbox
         from public.location_path
        where path = $1`,
      [locationPathPath],
    ),
  );
}

// Place rows with a given slug in a state, across counties. An agency whose
// geocoded point lands just outside its city's polygon snaps to the place its
// address names; the caller disambiguates (the point's county, else a lone match).
export async function readPlacesByStateAndSlug(
  client: DatabaseClient,
  stateSlug: string,
  placeSlug: string,
): Promise<DatabaseLocationPathRow[]> {
  return rowsFromResult(
    await client.query(
      `select location_path_id, path, level, state_or_territory_slug,
              administrative_area_slug, place_slug, state_or_territory_name,
              administrative_area_name, place_name, parent_location_path_id,
              centroid, bbox
         from public.location_path
        where level = 'place'
          and state_or_territory_slug = $1
          and place_slug = $2`,
      [stateSlug, placeSlug],
    ),
  ) as unknown as DatabaseLocationPathRow[];
}

// The place nearest a point within a state (KNN by boundary distance). An
// agency's address is its office building, a physical point, so when no place
// contains it and its city names no place, the nearest place is a valid location.
export async function readNearestPlace(
  client: DatabaseClient,
  input: { latitude: number; longitude: number; stateSlug: string },
): Promise<DatabaseLocationPathRow | undefined> {
  return firstRow<DatabaseLocationPathRow>(
    await client.query(
      `select lp.location_path_id, lp.path, lp.level, lp.state_or_territory_slug,
              lp.administrative_area_slug, lp.place_slug, lp.state_or_territory_name,
              lp.administrative_area_name, lp.place_name, lp.parent_location_path_id,
              case when lp.centroid is null then null
                   else ST_AsGeoJSON(lp.centroid::geometry)::jsonb end as centroid,
              case when lp.bbox is null then null
                   else ST_AsGeoJSON(lp.bbox)::jsonb end as bbox
         from public.location_path lp
         join public.location_path_geometry lpg
           on lpg.location_path_id = lp.location_path_id
        where lp.level = 'place'
          and lp.state_or_territory_slug = $3
        order by lpg.boundary <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
        limit 1`,
      [input.longitude, input.latitude, input.stateSlug],
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

export async function readLocationPathsContainingPoint(
  client: DatabaseClient,
  input: {
    latitude: number;
    longitude: number;
    level: "state" | "administrative_area" | "place";
  },
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
        where lp.level = $3
          and ST_Covers(lpg.boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))`,
      [input.longitude, input.latitude, input.level],
    ),
  ) as unknown as DatabaseLocationPathRow[];
}
