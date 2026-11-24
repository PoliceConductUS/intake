export type GazetteerRole =
  | "statesZip"
  | "adminAreasZip"
  | "placesZip"
  | "stateTigerZip"
  | "countyTigerZip"
  | "placeTigerZips"
  | "countySubdivisionTigerZips"
  | "consolidatedCityTigerZips"
  | "hierarchyFile";

const ROLE_PATTERNS: Record<GazetteerRole, RegExp> = {
  countySubdivisionTigerZips: /tl_\d{4}_\d{2}_cousub\.zip/,
  consolidatedCityTigerZips: /tl_\d{4}_\d{2}_concity\.zip/,
  stateTigerZip: /tl_\d{4}_us_state\.zip/,
  countyTigerZip: /tl_\d{4}_us_county\.zip/,
  placeTigerZips: /tl_\d{4}_\d{2}_place\.zip/,
  statesZip: /gaz_state|state_national/,
  adminAreasZip: /gaz_count|counties_national|county_national/,
  placesZip: /gaz_place|place_national/,
  hierarchyFile: /relationship|rel20\d{2}/,
};

const ROLE_ORDER = [
  "countySubdivisionTigerZips",
  "consolidatedCityTigerZips",
  "stateTigerZip",
  "countyTigerZip",
  "placeTigerZips",
  "statesZip",
  "adminAreasZip",
  "placesZip",
  "hierarchyFile",
] as const satisfies ReadonlyArray<GazetteerRole>;

export const GAZETTEER_SINGLETON_ROLES = [
  "statesZip",
  "adminAreasZip",
  "placesZip",
  "stateTigerZip",
  "countyTigerZip",
] as const satisfies ReadonlyArray<GazetteerRole>;

export function classifyGazetteerRole(text: string): GazetteerRole | undefined {
  const lower = text.toLowerCase();
  for (const role of ROLE_ORDER) {
    if (ROLE_PATTERNS[role].test(lower)) return role;
  }
  return undefined;
}

// States with CONCITY features in the current Census TIGER release.
export const CONSOLIDATED_CITY_STATES = [
  "09",
  "13",
  "18",
  "20",
  "21",
  "30",
  "47",
] as const;
