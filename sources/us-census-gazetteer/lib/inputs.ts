import path from "node:path";

export interface MatchedInputs {
  statesZip: string;
  adminAreasZip: string;
  placesZip: string;
  stateTigerZip: string;
  countyTigerZip: string;
  placeTigerZips: string[];
  hierarchyFile?: string;
  year: string;
}

interface RoleMatch {
  path: string;
  year: string;
}

const GAZETTEER_YEAR_PATTERN = /(\d{4})_gaz_/i;
const TIGER_YEAR_PATTERN = /^tl_(\d{4})_/i;
const HIERARCHY_YEAR_PATTERN = /(\d{4})/;

/**
 * Extract the 4-digit year a matched filename claims to be for. Gazetteer
 * files encode it as `<year>_Gaz_...`; TIGER files as `tl_<year>_...`; the
 * (rare) hierarchy/relationship file falls back to the first 4-digit run.
 */
function extractYear(basename: string): string | undefined {
  const gazetteerMatch = basename.match(GAZETTEER_YEAR_PATTERN);
  if (gazetteerMatch) return gazetteerMatch[1];
  const tigerMatch = basename.match(TIGER_YEAR_PATTERN);
  if (tigerMatch) return tigerMatch[1];
  const fallbackMatch = basename.match(HIERARCHY_YEAR_PATTERN);
  return fallbackMatch?.[1];
}

/**
 * Classify a single file into the first role whose pattern matches its
 * basename (case-insensitive). Patterns are checked in an order that keeps
 * the gazetteer-place vs TIGER-place distinction unambiguous.
 */
function classify(p: string): keyof typeof ROLE_PATTERNS | undefined {
  const basename = path.basename(p);
  for (const role of ROLE_ORDER) {
    if (ROLE_PATTERNS[role].test(basename)) return role;
  }
  return undefined;
}

const ROLE_PATTERNS = {
  statesZip: /gaz_state|state_national/i,
  adminAreasZip: /gaz_count|counties_national|county_national/i,
  placesZip: /gaz_place|place_national/i,
  stateTigerZip: /^tl_\d{4}_us_state\.zip$/i,
  countyTigerZip: /^tl_\d{4}_us_county\.zip$/i,
  placeTigerZips: /^tl_\d{4}_\d{2}_place\.zip$/i,
  hierarchyFile: /relationship|rel20\d{2}/i,
} as const;

// Checked in this order so TIGER place zips (tl_YYYY_SS_place.zip) never
// fall through to the gazetteer-place pattern, and vice versa.
const ROLE_ORDER = [
  "stateTigerZip",
  "countyTigerZip",
  "placeTigerZips",
  "statesZip",
  "adminAreasZip",
  "placesZip",
  "hierarchyFile",
] as const satisfies ReadonlyArray<keyof typeof ROLE_PATTERNS>;

const SINGLETON_ROLES = [
  "statesZip",
  "adminAreasZip",
  "placesZip",
  "stateTigerZip",
  "countyTigerZip",
] as const satisfies ReadonlyArray<keyof typeof ROLE_PATTERNS>;

/**
 * Classify census input file paths by basename into their gazetteer/TIGER
 * roles and extract (and cross-check) the vintage year. Pure/deterministic:
 * operates on the path strings only, no filesystem access.
 */
export function matchInputs(paths: string[]): MatchedInputs {
  const matches: Record<keyof typeof ROLE_PATTERNS, RoleMatch[]> = {
    statesZip: [],
    adminAreasZip: [],
    placesZip: [],
    stateTigerZip: [],
    countyTigerZip: [],
    placeTigerZips: [],
    hierarchyFile: [],
  };

  for (const p of paths) {
    const role = classify(p);
    if (!role) continue;
    const basename = path.basename(p);
    const year = extractYear(basename);
    if (!year) {
      throw new Error(
        `us-census-gazetteer inputs: could not extract a year from "${basename}" (matched role "${role}")`,
      );
    }
    matches[role].push({ path: p, year });
  }

  for (const role of SINGLETON_ROLES) {
    const found = matches[role];
    if (found.length === 0) {
      throw new Error(
        `us-census-gazetteer inputs: no file matched role "${role}" in [${paths.join(", ")}]`,
      );
    }
    if (found.length > 1) {
      throw new Error(
        `us-census-gazetteer inputs: expected exactly one file for role "${role}" but found ${found.length}: [${found
          .map((m) => m.path)
          .join(", ")}]`,
      );
    }
  }

  if (matches.placeTigerZips.length === 0) {
    throw new Error(
      `us-census-gazetteer inputs: no file matched role "placeTigerZips" (need at least one tl_<year>_<state>_place.zip) in [${paths.join(", ")}]`,
    );
  }

  if (matches.hierarchyFile.length > 1) {
    throw new Error(
      `us-census-gazetteer inputs: expected at most one file for role "hierarchyFile" but found ${matches.hierarchyFile.length}: [${matches.hierarchyFile
        .map((m) => m.path)
        .join(", ")}]`,
    );
  }

  const allMatches = [
    ...matches.statesZip,
    ...matches.adminAreasZip,
    ...matches.placesZip,
    ...matches.stateTigerZip,
    ...matches.countyTigerZip,
    ...matches.placeTigerZips,
    ...matches.hierarchyFile,
  ];
  const year = allMatches[0].year;
  const mismatched = allMatches.filter((m) => m.year !== year);
  if (mismatched.length > 0) {
    throw new Error(
      `us-census-gazetteer inputs: year mismatch — expected all matched files to be for year "${year}" but found: [${mismatched
        .map((m) => `${m.path} (${m.year})`)
        .join(", ")}]`,
    );
  }

  return {
    statesZip: matches.statesZip[0].path,
    adminAreasZip: matches.adminAreasZip[0].path,
    placesZip: matches.placesZip[0].path,
    stateTigerZip: matches.stateTigerZip[0].path,
    countyTigerZip: matches.countyTigerZip[0].path,
    placeTigerZips: matches.placeTigerZips.map((m) => m.path),
    hierarchyFile: matches.hierarchyFile[0]?.path,
    year,
  };
}
