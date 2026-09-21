import path from "node:path";
import {
  classifyGazetteerRole,
  CONSOLIDATED_CITY_STATES,
  GAZETTEER_SINGLETON_ROLES,
  type GazetteerRole,
} from "./roles.js";

export interface MatchedInputs {
  statesZip: string;
  adminAreasZip: string;
  placesZip: string;
  stateTigerZip: string;
  countyTigerZip: string;
  placeTigerZips: string[];
  countySubdivisionTigerZips: string[];
  consolidatedCityTigerZips: string[];
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

function extractYear(basename: string): string | undefined {
  const gazetteerMatch = basename.match(GAZETTEER_YEAR_PATTERN);
  if (gazetteerMatch) return gazetteerMatch[1];
  const tigerMatch = basename.match(TIGER_YEAR_PATTERN);
  if (tigerMatch) return tigerMatch[1];
  const fallbackMatch = basename.match(HIERARCHY_YEAR_PATTERN);
  return fallbackMatch?.[1];
}

export function matchInputs(paths: string[]): MatchedInputs {
  const matches: Record<GazetteerRole, RoleMatch[]> = {
    statesZip: [],
    adminAreasZip: [],
    placesZip: [],
    stateTigerZip: [],
    countyTigerZip: [],
    placeTigerZips: [],
    countySubdivisionTigerZips: [],
    consolidatedCityTigerZips: [],
    hierarchyFile: [],
  };

  for (const p of paths) {
    const basename = path.basename(p);
    const role = classifyGazetteerRole(basename);
    if (!role) continue;
    const year = extractYear(basename);
    if (!year) {
      throw new Error(
        `us-census-gazetteer inputs: could not extract a year from "${basename}" (matched role "${role}")`,
      );
    }
    matches[role].push({ path: p, year });
  }

  for (const role of GAZETTEER_SINGLETON_ROLES) {
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
    ...matches.countySubdivisionTigerZips,
    ...matches.consolidatedCityTigerZips,
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

  const stateOf = (file: RoleMatch) => path.basename(file.path).split("_")[2];
  const placeStates = matches.placeTigerZips.map(stateOf);
  for (const [role, requiredStates] of [
    ["countySubdivisionTigerZips", placeStates],
    [
      "consolidatedCityTigerZips",
      placeStates.filter((s) =>
        (CONSOLIDATED_CITY_STATES as readonly string[]).includes(s),
      ),
    ],
  ] as const) {
    const found = matches[role].map(stateOf);
    const missing = requiredStates.filter((s) => !found.includes(s));
    if (missing.length)
      throw new Error(
        `us-census-gazetteer inputs: missing ${role} for states ${missing.join(", ")}; acquire the complete Census source set`,
      );
    if (new Set(found).size !== found.length)
      throw new Error(`Duplicate ${role} state files`);
    const extra = found.filter((s) => !placeStates.includes(s));
    if (extra.length)
      throw new Error(
        `${role} has states without PLACE input: ${extra.join(", ")}`,
      );
  }

  return {
    statesZip: matches.statesZip[0].path,
    adminAreasZip: matches.adminAreasZip[0].path,
    placesZip: matches.placesZip[0].path,
    stateTigerZip: matches.stateTigerZip[0].path,
    countyTigerZip: matches.countyTigerZip[0].path,
    placeTigerZips: matches.placeTigerZips.map((m) => m.path),
    countySubdivisionTigerZips: matches.countySubdivisionTigerZips.map(
      (m) => m.path,
    ),
    consolidatedCityTigerZips: matches.consolidatedCityTigerZips.map(
      (m) => m.path,
    ),
    hierarchyFile: matches.hierarchyFile[0]?.path,
    year,
  };
}
