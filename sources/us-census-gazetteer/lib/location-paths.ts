import { allowedStateSlugs } from "./constants.js";
import type {
  GazetteerAdministrativeAreaRecord,
  GazetteerPlaceRecord,
  GazetteerStateRecord,
} from "./schemas.js";

/** Pure Census records keyed by geography type and GEOID; paths are descriptive output. */

const sourceContextSymbol: unique symbol = Symbol("sourceContext");

interface SourceContext {
  geoid: string;
  label: string;
}

export interface HierarchyMatch {
  stateGeoid: string;
  administrativeAreaGeoid: string;
  placeGeoid: string;
  placeName?: string;
  overlapTotalArea: number;
  sourceKey: string;
}

export interface BuildLocationPathsInput {
  states: GazetteerStateRecord[];
  administrativeAreas: GazetteerAdministrativeAreaRecord[];
  places: GazetteerPlaceRecord[];
  hierarchy: HierarchyMatch[];
}

export interface LocationPathRow {
  location_path_id: string;
  path: string;
  level: "state" | "administrative_area" | "place";
  display_name: string;
  resolution_class?: "primary" | "county_subdivision" | "consolidated_city";
  parent_location_path_id: string | null;
  latitude: string;
  longitude: string;
  [sourceContextSymbol]?: SourceContext;
}

export interface AlternateAdministrativeArea {
  sourceKey: string;
  label: string;
  path: string;
  aliasPath: string;
  overlapTotalArea: number;
}

export type HierarchySelectionReason =
  | "largest_total_area_overlap_then_lexical_path"
  | "largest_total_area_overlap";

export interface HierarchySelection {
  note: string;
  reason: HierarchySelectionReason;
  selectedAdministrativeAreaSourceKey: string;
  selectedAdministrativeAreaLabel: string;
  selectedAdministrativeAreaPath: string;
  selectedOverlapTotalArea: number;
  alternateAdministrativeAreas: AlternateAdministrativeArea[];
}

export interface LocationPathSourceEvidence {
  sourceKey: string;
  parentSourceKey?: string;
  sourceHierarchyKey?: string;
  sourceHierarchyOverlapTotalArea?: number;
  hierarchySelection?: HierarchySelection;
}

export interface LocationPathAliasEntry {
  alias_path: string;
  location_path_id: string;
  parent_location_path_id: string;
}

export interface LocationPathAliasSourceEvidence {
  sourceKey: string;
}

export interface BuildLocationPathsResult {
  locationPaths: Record<string, LocationPathRow>;
  locationPathSources: Record<string, LocationPathSourceEvidence>;
  locationPathAlias: Record<string, LocationPathAliasEntry>;
  locationPathAliasSources: Record<string, LocationPathAliasSourceEvidence>;
  warnings: string[];
}

interface PlaceCandidate {
  match: HierarchyMatch;
  place: GazetteerPlaceRecord;
  state: GazetteerStateRecord;
  administrativeArea: GazetteerAdministrativeAreaRecord;
  administrativeAreaPath: string;
}

interface AssignedPlaceCandidate extends PlaceCandidate {
  placeName: string;
  placeSlug: string;
  placePath: string;
}

type GazetteerLikeRecord = {
  GEOID: string;
  NAME: string;
  INTPTLAT: string;
  INTPTLONG: string;
};

interface SkippedWarningParent {
  type: string;
  geoid: string;
  slug: string;
}

export function buildLocationPaths({
  states,
  administrativeAreas,
  places,
  hierarchy,
}: BuildLocationPathsInput): BuildLocationPathsResult {
  const warnings: string[] = [];
  const locationPaths = new Map<string, LocationPathRow>();
  const locationPathSources = new Map<string, LocationPathSourceEvidence>();
  const locationPathAlias = new Map<string, LocationPathAliasEntry>();
  const locationPathAliasSources = new Map<
    string,
    LocationPathAliasSourceEvidence
  >();
  const statesByGeoid = new Map<string, GazetteerStateRecord>();
  const administrativeAreasByGeoid = new Map<
    string,
    GazetteerAdministrativeAreaRecord
  >();

  for (const state of states) {
    const stateSlug = state.USPS.toLowerCase();
    const statePath = `/${stateSlug}/`;
    if (!allowedStateSlugs.has(stateSlug)) {
      warnings.push(
        skippedWarning({
          type: "state",
          path: statePath,
          reason: "outside 50 states plus District of Columbia",
          record: state,
        }),
      );
      continue;
    }

    statesByGeoid.set(state.GEOID, state);
    addLocationPath(
      locationPaths,
      sourceKey("state", state.GEOID),
      stateLocationPath(state, statePath),
      sourceContext(state),
    );
    locationPathSources.set(sourceKey("state", state.GEOID), {
      sourceKey: sourceKey("state", state.GEOID),
    });
  }

  for (const administrativeArea of administrativeAreas) {
    const state = statesByGeoid.get(administrativeArea.GEOID.slice(0, 2));
    if (state === undefined) {
      const stateSlug = administrativeArea.USPS.toLowerCase();
      warnings.push(
        skippedWarning({
          type: "administrative_area",
          path: `/${stateSlug}/${slugFromSourceName(administrativeArea.NAME)}/`,
          reason: "missing generated state parent",
          record: administrativeArea,
          parent: {
            type: "state",
            geoid: administrativeArea.GEOID.slice(0, 2),
            slug: stateSlug,
          },
        }),
      );
      continue;
    }

    administrativeAreasByGeoid.set(
      administrativeArea.GEOID,
      administrativeArea,
    );
    const administrativeAreaPath = administrativeAreaPathFor({
      state,
      administrativeArea,
    });
    addLocationPath(
      locationPaths,
      sourceKey("administrative_area", administrativeArea.GEOID),
      administrativeAreaLocationPath({
        state,
        administrativeArea,
        administrativeAreaPath,
      }),
      sourceContext(administrativeArea),
    );
    locationPathSources.set(
      sourceKey("administrative_area", administrativeArea.GEOID),
      {
        sourceKey: sourceKey("administrative_area", administrativeArea.GEOID),
        parentSourceKey: sourceKey("state", state.GEOID),
      },
    );
  }

  const hierarchyByPlaceGeoid = groupHierarchyByPlaceGeoid(hierarchy);
  const plannedPlaces: {
    place: GazetteerPlaceRecord;
    candidates: PlaceCandidate[];
  }[] = [];
  for (const place of places) {
    const stateSlug = place.USPS.toLowerCase();
    if (!allowedStateSlugs.has(stateSlug)) {
      warnings.push(
        skippedWarning({
          type: "place",
          path: `/${stateSlug}/${slugFromSourceName(place.NAME)}/`,
          reason: "outside 50 states plus District of Columbia",
          record: place,
          parent: {
            type: "state",
            geoid: place.GEOID.slice(0, 2),
            slug: stateSlug,
          },
        }),
      );
      continue;
    }

    const matches = hierarchyByPlaceGeoid.get(place.GEOID) ?? [];
    if (matches.length === 0) {
      throw new Error(
        `Missing Census-proven parent for place ${place.GEOID} ${place.NAME}`,
      );
    }

    const candidates = matches.map((match) =>
      buildPlaceCandidate({
        match,
        place,
        statesByGeoid,
        administrativeAreasByGeoid,
      }),
    );
    plannedPlaces.push({ place, candidates });
  }

  for (const plan of plannedPlaces) {
    const candidates = plan.candidates.map(assignPlacePath);
    const defaultCandidate = chooseDefaultPlaceCandidate(candidates);
    addLocationPath(
      locationPaths,
      sourceKey("place", defaultCandidate.place.GEOID),
      placeLocationPath(defaultCandidate),
      sourceContext(defaultCandidate.place),
    );
    locationPathSources.set(
      sourceKey("place", defaultCandidate.place.GEOID),
      placeLocationPathEvidence(defaultCandidate, candidates),
    );

    for (const candidate of candidates) {
      if (
        candidate.administrativeArea.GEOID ===
        defaultCandidate.administrativeArea.GEOID
      )
        continue;
      const placeKey = sourceKey("place", candidate.place.GEOID);
      const parentKey = sourceKey(
        "administrative_area",
        candidate.administrativeArea.GEOID,
      );
      const aliasKey = `${placeKey}:${parentKey}`;
      if (locationPathAlias.has(aliasKey))
        throw new Error(`Duplicate Census alias ${aliasKey}`);
      locationPathAlias.set(aliasKey, {
        alias_path: candidate.placePath,
        location_path_id: placeKey,
        parent_location_path_id: parentKey,
      });
      locationPathAliasSources.set(aliasKey, { sourceKey: aliasKey });
    }
  }

  return {
    locationPaths: sortedObject(locationPaths),
    locationPathSources: sortedObject(locationPathSources),
    locationPathAlias: sortedObject(locationPathAlias),
    locationPathAliasSources: sortedObject(locationPathAliasSources),
    warnings: warnings.sort(),
  };
}

export function slugFromSourceName(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stateLocationPath(
  state: GazetteerStateRecord,
  statePath: string,
): LocationPathRow {
  return {
    location_path_id: sourceKey("state", state.GEOID),
    path: statePath,
    level: "state",
    display_name: state.NAME,
    parent_location_path_id: null,
    latitude: state.INTPTLAT,
    longitude: state.INTPTLONG,
  };
}

function administrativeAreaLocationPath({
  state,
  administrativeArea,
  administrativeAreaPath,
}: {
  state: GazetteerStateRecord;
  administrativeArea: GazetteerAdministrativeAreaRecord;
  administrativeAreaPath: string;
}): LocationPathRow {
  return {
    location_path_id: sourceKey(
      "administrative_area",
      administrativeArea.GEOID,
    ),
    path: administrativeAreaPath,
    level: "administrative_area",
    display_name: administrativeArea.NAME,
    parent_location_path_id: sourceKey("state", state.GEOID),
    latitude: administrativeArea.INTPTLAT,
    longitude: administrativeArea.INTPTLONG,
  };
}

function placeLocationPath(candidate: AssignedPlaceCandidate): LocationPathRow {
  return {
    location_path_id: sourceKey("place", candidate.place.GEOID),
    path: candidate.placePath,
    level: "place",
    display_name: candidate.placeName,
    parent_location_path_id: sourceKey(
      "administrative_area",
      candidate.administrativeArea.GEOID,
    ),
    latitude: candidate.place.INTPTLAT,
    longitude: candidate.place.INTPTLONG,
  };
}

function placeLocationPathEvidence(
  candidate: AssignedPlaceCandidate,
  candidates: AssignedPlaceCandidate[],
): LocationPathSourceEvidence {
  const hierarchySelection =
    candidates.length > 1
      ? hierarchySelectionForPlace(candidate, candidates)
      : undefined;
  const metadata: LocationPathSourceEvidence = {
    sourceKey: sourceKey("place", candidate.place.GEOID),
    parentSourceKey: sourceKey(
      "administrative_area",
      candidate.administrativeArea.GEOID,
    ),
    sourceHierarchyKey: candidate.match.sourceKey,
    sourceHierarchyOverlapTotalArea: candidate.match.overlapTotalArea,
  };
  if (hierarchySelection !== undefined) {
    metadata.hierarchySelection = hierarchySelection;
  }
  return metadata;
}

function hierarchySelectionForPlace(
  defaultCandidate: AssignedPlaceCandidate,
  candidates: AssignedPlaceCandidate[],
): HierarchySelection {
  const alternates = sortedPlaceCandidates(
    candidates.filter(
      (candidate) =>
        candidate.administrativeArea.GEOID !==
        defaultCandidate.administrativeArea.GEOID,
    ),
  );
  const reason = hierarchySelectionReason(defaultCandidate, candidates);
  return {
    note: hierarchySelectionNote(defaultCandidate, candidates, reason),
    reason,
    selectedAdministrativeAreaSourceKey: sourceKey(
      "administrative_area",
      defaultCandidate.administrativeArea.GEOID,
    ),
    selectedAdministrativeAreaLabel: defaultCandidate.administrativeArea.NAME,
    selectedAdministrativeAreaPath: defaultCandidate.administrativeAreaPath,
    selectedOverlapTotalArea: defaultCandidate.match.overlapTotalArea,
    alternateAdministrativeAreas: alternates.map((candidate) => ({
      sourceKey: sourceKey(
        "administrative_area",
        candidate.administrativeArea.GEOID,
      ),
      label: candidate.administrativeArea.NAME,
      path: candidate.administrativeAreaPath,
      aliasPath: candidate.placePath,
      overlapTotalArea: candidate.match.overlapTotalArea,
    })),
  };
}

function hierarchySelectionReason(
  defaultCandidate: AssignedPlaceCandidate,
  candidates: AssignedPlaceCandidate[],
): HierarchySelectionReason {
  const selectedOverlap = defaultCandidate.match.overlapTotalArea;
  const tiedLargestCount = candidates.filter(
    (candidate) => candidate.match.overlapTotalArea === selectedOverlap,
  ).length;
  return tiedLargestCount > 1
    ? "largest_total_area_overlap_then_lexical_path"
    : "largest_total_area_overlap";
}

function hierarchySelectionNote(
  defaultCandidate: AssignedPlaceCandidate,
  candidates: AssignedPlaceCandidate[],
  reason: HierarchySelectionReason,
): string {
  const placeLabel = defaultCandidate.placeName;
  const administrativeAreaLabels = sortedPlaceCandidates(candidates).map(
    (candidate) => candidate.administrativeArea.NAME,
  );
  const spanSentence = `${placeLabel} spans ${serialList(administrativeAreaLabels)}.`;
  if (reason === "largest_total_area_overlap_then_lexical_path") {
    return `${spanSentence} ${defaultCandidate.administrativeArea.NAME} is used for all PoliceConduct.org purposes because it ties for the largest total-area overlap with ${placeLabel} and has the first path in lexical order.`;
  }

  return `${spanSentence} ${defaultCandidate.administrativeArea.NAME} is used for all PoliceConduct.org purposes because it has the largest total-area overlap with ${placeLabel}.`;
}

function sortedPlaceCandidates(
  candidates: AssignedPlaceCandidate[],
): AssignedPlaceCandidate[] {
  return [...candidates].sort((left, right) =>
    left.placePath.localeCompare(right.placePath),
  );
}

function serialList(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function buildPlaceCandidate({
  match,
  place,
  statesByGeoid,
  administrativeAreasByGeoid,
}: {
  match: HierarchyMatch;
  place: GazetteerPlaceRecord;
  statesByGeoid: Map<string, GazetteerStateRecord>;
  administrativeAreasByGeoid: Map<string, GazetteerAdministrativeAreaRecord>;
}): PlaceCandidate {
  const state = statesByGeoid.get(match.stateGeoid);
  const administrativeArea = administrativeAreasByGeoid.get(
    match.administrativeAreaGeoid,
  );
  if (state === undefined || administrativeArea === undefined) {
    throw new Error(
      `Missing Census-proven parent for place ${place.GEOID} ${place.NAME}`,
    );
  }

  const administrativeAreaPath = administrativeAreaPathFor({
    state,
    administrativeArea,
  });
  return {
    match,
    place,
    state,
    administrativeArea,
    administrativeAreaPath,
  };
}

function administrativeAreaPathFor({
  state,
  administrativeArea,
}: {
  state: GazetteerStateRecord;
  administrativeArea: GazetteerAdministrativeAreaRecord;
}): string {
  return `/${state.USPS.toLowerCase()}/${slugFromSourceName(administrativeArea.NAME)}/`;
}

function assignPlacePath(candidate: PlaceCandidate): AssignedPlaceCandidate {
  const placeName = placePreferredName(candidate);
  return {
    ...candidate,
    placeName,
    placeSlug: slugFromSourceName(placeName),
    placePath: placeCandidatePath(candidate, placeName),
  };
}

function placeCandidatePath(
  candidate: PlaceCandidate,
  placeName: string,
): string {
  return `${candidate.administrativeAreaPath}${slugFromSourceName(placeName)}/`;
}

function placePreferredName(candidate: PlaceCandidate): string {
  const placeName = candidate.match.placeName?.trim();
  if (placeName) return placeName;
  return candidate.place.NAME;
}

function chooseDefaultPlaceCandidate(
  candidates: AssignedPlaceCandidate[],
): AssignedPlaceCandidate {
  return [...candidates].sort((left, right) => {
    const overlapComparison =
      right.match.overlapTotalArea - left.match.overlapTotalArea;
    if (overlapComparison !== 0) return overlapComparison;
    return left.placePath.localeCompare(right.placePath);
  })[0];
}

function groupHierarchyByPlaceGeoid(
  hierarchy: HierarchyMatch[],
): Map<string, HierarchyMatch[]> {
  const grouped = new Map<string, HierarchyMatch[]>();
  for (const match of hierarchy) {
    const matches = grouped.get(match.placeGeoid) ?? [];
    matches.push(match);
    grouped.set(match.placeGeoid, matches);
  }
  return grouped;
}

function addLocationPath(
  locationPaths: Map<string, LocationPathRow>,
  path: string,
  row: LocationPathRow,
  context: SourceContext | undefined,
): void {
  if (locationPaths.has(path)) {
    throw new Error(
      `Duplicate Census source key ${path}${duplicateSourceDetails(
        locationPaths.get(path)?.[sourceContextSymbol],
        context,
      )}`,
    );
  }

  if (context !== undefined) {
    Object.defineProperty(row, sourceContextSymbol, {
      value: context,
      enumerable: false,
    });
  }

  locationPaths.set(path, row);
}

function sourceContext(record: GazetteerLikeRecord): SourceContext {
  return {
    geoid: record.GEOID,
    label: record.NAME,
  };
}

function duplicateSourceDetails(
  existing: SourceContext | undefined,
  next: SourceContext | undefined,
): string {
  const details = [existing, next]
    .filter((context): context is SourceContext => Boolean(context))
    .map((context, index) => {
      const prefix = index === 0 ? "existing" : "new";
      return `${prefix} source GEOID ${context.geoid}, label "${context.label}"`;
    });
  if (details.length === 0) return "";
  return ` (${details.join("; ")})`;
}

function sortedObject<T>(map: Map<string, T>): Record<string, T> {
  return Object.fromEntries(
    [...map.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sourceKey(type: string, geoid: string): string {
  return `${type}:GEOID:${geoid}`;
}

function skippedWarning({
  type,
  path,
  reason,
  record,
  parent,
}: {
  type: string;
  path: string;
  reason: string;
  record: GazetteerLikeRecord;
  parent?: SkippedWarningParent;
}): string {
  const details = [
    `source GEOID ${record.GEOID}`,
    `label "${record.NAME}"`,
    `lat ${record.INTPTLAT}`,
    `lng ${record.INTPTLONG}`,
  ];
  if (parent !== undefined) {
    details.push(
      `parent ${parent.type} GEOID ${parent.geoid}`,
      `parent slug ${parent.slug}`,
    );
  }
  return `skipped ${type}: ${path} due to ${reason} (${details.join(", ")})`;
}
