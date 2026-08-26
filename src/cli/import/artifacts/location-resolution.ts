import { valueAsString } from "./resolver-kit.js";
import {
  readLocationPathAliasByPath,
  readLocationPathById,
  readLocationPathByPath,
  readLocationPathsContainingPoint,
  readNearestPlace,
  readPlacesByStateAndSlug,
} from "../../database/location-paths.js";
import type { LocationPathRow } from "../../../shared/io/generated/entity-specs.js";
// Type-only (erased at runtime), so there is no import cycle with data-context,
// which imports these classes and types as values/types.
import type { DataContext } from "./data-context.js";

export type AddressResolutionRequest = {
  entityType: string;
  entityId: string;
  sourceName?: string;
  name?: string;
  address: string;
  place: string;
  state: string;
  zipCode: string;
  administrativeAreaName?: string;
  administrativeAreaSlug?: string;
  latitude?: number;
  longitude?: number;
};

export type AddressResolution = {
  latitude: number;
  longitude: number;
};

export type LocationResolution = {
  locationPathId: string;
  addressLatitude: number;
  addressLongitude: number;
};

export type ResolveAddressInput = {
  entityType: string;
  entityId: string;
  state?: string;
  place?: string;
  zipCode?: string;
  address?: string;
  administrativeAreaName?: string;
  administrativeAreaSlug?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
  sourceName?: string;
  preferredLocationPathId?: string;
};

function normalizeAddressToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// A place slug matching the census `place_slug` convention, so a city name
// composes into its place path (`/tx/bexar-county/` + `san-antonio` + `/`).
function citySlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function zip5(value: string): string {
  return value.trim().slice(0, 5);
}

// STOPGAP: a hand-listed fallback for postal-only ZIPs whose geocoded point
// lands in no place/administrative_area/state boundary. It does not generalize —
// every new such ZIP must be added here. Replace with a general postal-area →
// location_path mechanism (e.g. a ZCTA→place crosswalk) rather than growing this
// table; `postalAreaPlacePaths` is the single point to swap out when that lands.
const POSTAL_AREA_PLACE_PATHS: readonly {
  state: string;
  zip5: string;
  places: readonly string[];
  paths: readonly string[];
}[] = [
  {
    state: "MN",
    zip5: "55111",
    places: ["st paul", "saint paul", "stpaul"],
    paths: ["/mn/ramsey-county/st-paul/", "/mn/ramsey-county/saint-paul/"],
  },
  {
    state: "MN",
    zip5: "55450",
    places: ["minneapolis"],
    paths: ["/mn/hennepin-county/minneapolis/"],
  },
  {
    state: "MN",
    zip5: "55804",
    places: ["duluth"],
    paths: ["/mn/st-louis-county/duluth/"],
  },
  {
    state: "MN",
    zip5: "56270",
    places: ["morton"],
    paths: ["/mn/renville-county/morton/"],
  },
  {
    state: "MN",
    zip5: "56241",
    places: ["granite falls"],
    paths: ["/mn/chippewa-county/granite-falls/"],
  },
];

function postalAreaPlacePaths(request: AddressResolutionRequest): string[] {
  const state = request.state.trim().toUpperCase();
  const normalizedPlace = normalizeAddressToken(request.place);
  const postalZip = zip5(request.zipCode);
  const rule = POSTAL_AREA_PLACE_PATHS.find(
    (candidate) =>
      candidate.state === state &&
      candidate.zip5 === postalZip &&
      candidate.places.includes(normalizedPlace),
  );

  return rule === undefined ? [] : [...rule.paths];
}

// An agency resolves to a place, or (on a place miss) the county the point falls
// in — used only to compose the address city's place path. No state fallback: an
// agency's location_path must be a place.
const CONTAINING_POINT_LEVELS = ["place", "administrative_area"] as const;

function isMissingContainingPlaceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("no place location_path_geometry boundary contains")
  );
}

function addressResolutionRequest(
  input: ResolveAddressInput,
): AddressResolutionRequest {
  const missingFields = [
    valueAsString(input.entityType) === undefined ? "entityType" : undefined,
    valueAsString(input.entityId) === undefined ? "entityId" : undefined,
    valueAsString(input.state) === undefined ? "state" : undefined,
    valueAsString(input.place) === undefined ? "place" : undefined,
    valueAsString(input.zipCode) === undefined ? "zipCode" : undefined,
    valueAsString(input.address) === undefined ? "address" : undefined,
  ].filter((fieldName): fieldName is string => fieldName !== undefined);

  if (missingFields.length > 0) {
    throw new Error(
      `Cannot resolve address for ${String(input.entityType)} ${String(input.entityId)} without ${missingFields.join(", ")}.`,
    );
  }

  return {
    entityType: input.entityType,
    entityId: input.entityId,
    ...(valueAsString(input.sourceName) === undefined
      ? {}
      : { sourceName: valueAsString(input.sourceName)! }),
    ...(valueAsString(input.name) === undefined
      ? {}
      : { name: valueAsString(input.name)! }),
    address: input.address!,
    place: input.place!,
    state: input.state!,
    zipCode: input.zipCode!,
    ...(valueAsString(input.administrativeAreaName) === undefined
      ? {}
      : {
          administrativeAreaName: valueAsString(input.administrativeAreaName)!,
        }),
    ...(valueAsString(input.administrativeAreaSlug) === undefined
      ? {}
      : {
          administrativeAreaSlug: valueAsString(input.administrativeAreaSlug)!,
        }),
    ...(Number.isFinite(input.latitude) ? { latitude: input.latitude } : {}),
    ...(Number.isFinite(input.longitude) ? { longitude: input.longitude } : {}),
  };
}

/** Geocodes an address to a canonical location: geocode → point-in-boundary. */
export class LocationDataContext {
  constructor(private readonly context: DataContext) {}

  private async postalAreaLocationPathId(
    request: AddressResolutionRequest,
  ): Promise<string | undefined> {
    for (const path of postalAreaPlacePaths(request)) {
      const locationPath = await this.context.locationPaths.getByPath(path);
      if (locationPath !== undefined) {
        return locationPath.location_path_id;
      }
    }

    return undefined;
  }

  async resolveAddress(
    input: ResolveAddressInput,
  ): Promise<LocationResolution> {
    const request = addressResolutionRequest(input);
    const cached = this.context.getCachedLocation(
      request.entityType,
      request.entityId,
    );
    if (cached !== undefined) {
      return cached;
    }

    const addressResolution = await this.context.resolveAddress(request);
    if (addressResolution === undefined) {
      throw new Error(
        `Cannot resolve address for ${request.entityType} ${request.entityId}.`,
      );
    }

    let locationPathId: string;
    try {
      locationPathId = await this.context.locationPaths.getPlaceContainingPoint(
        {
          latitude: addressResolution.latitude,
          longitude: addressResolution.longitude,
          subject: `${request.entityType} ${request.entityId}`,
          place: request.place,
          stateSlug: request.state,
        },
      );
    } catch (error) {
      if (!isMissingContainingPlaceError(error)) {
        throw error;
      }
      const postalLocationPathId = await this.postalAreaLocationPathId(request);
      if (postalLocationPathId === undefined) {
        throw error;
      }
      locationPathId = postalLocationPathId;
    }
    const resolution = {
      locationPathId,
      addressLatitude: addressResolution.latitude,
      addressLongitude: addressResolution.longitude,
    };
    this.context.cacheLocation(
      request.entityType,
      request.entityId,
      resolution,
    );
    return resolution;
  }
}

/** Reads census-owned location_path rows by path/alias/id and by containing point. */
export class LocationPathDataContext {
  constructor(private readonly context: DataContext) {}

  // The census hierarchy is read-only during an import, so a path resolves to the
  // same row every time; memoize per path so N same-state records share one read.
  private readonly byPathCache = new Map<
    string,
    Promise<LocationPathRow | undefined>
  >();

  // A location_path_id source key is the full path string; resolve it by a lazy
  // per-reference read of the census-owned tables (ADR 0024): the location_path
  // by `path`, else the location_path_alias by `alias_path`. The caller (a field
  // resolver) caches the hit and fails loud when neither matches.
  getByPath(path: string): Promise<LocationPathRow | undefined> {
    let pending = this.byPathCache.get(path);
    if (pending === undefined) {
      pending = this.readByPath(path);
      this.byPathCache.set(path, pending);
    }
    return pending;
  }

  private async readByPath(path: string): Promise<LocationPathRow | undefined> {
    const client = this.context.databaseClient();
    const direct = await readLocationPathByPath(client, path);
    if (direct !== undefined) {
      return direct;
    }
    const alias = await readLocationPathAliasByPath(client, path);
    return alias === undefined
      ? undefined
      : readLocationPathById(client, alias.location_path_id);
  }

  async getById(locationPathId: string): Promise<LocationPathRow | undefined> {
    return readLocationPathById(this.context.databaseClient(), locationPathId);
  }

  private async uniqueContainingLocationPath(
    input: { latitude: number; longitude: number; subject: string },
    level: (typeof CONTAINING_POINT_LEVELS)[number],
  ): Promise<string | undefined> {
    const matches = await readLocationPathsContainingPoint(
      this.context.databaseClient(),
      { latitude: input.latitude, longitude: input.longitude, level },
    );
    if (matches.length === 0) return undefined;
    const uniqueMatches = [
      ...new Map(
        matches.map((locationPath) => [
          locationPath.location_path_id,
          locationPath,
        ]),
      ).values(),
    ];
    if (uniqueMatches.length > 1) {
      throw new Error(
        `Cannot resolve location_path_id for ${input.subject}; multiple ${level} location_path_geometry boundaries contain point ${input.latitude}, ${input.longitude}: ${uniqueMatches
          .map((locationPath) => locationPath.location_path_id)
          .sort()
          .join(", ")}.`,
      );
    }
    return uniqueMatches[0]!.location_path_id;
  }

  // An agency's location_path must be a *place*, never a county (the website
  // excludes county-level agencies from projections). Point-in-polygon is exact
  // when a census place polygon contains the point, but a mailing address often
  // geocodes just outside a city's polygon (mailing areas sprawl past city
  // limits) — so on a place miss, snap to the place the address names inside the
  // county the point falls in. A genuinely placeless address fails loud, to be
  // fixed by a seeded resolved-property or the postal fallback.
  async getPlaceContainingPoint(input: {
    latitude: number;
    longitude: number;
    /** A label for the record being resolved, for error context (e.g. "agency <id>"). */
    subject: string;
    /** The address city and state, used to snap to a place when the point is in none. */
    place?: string;
    stateSlug?: string;
  }): Promise<string> {
    const placeId = await this.uniqueContainingLocationPath(input, "place");
    if (placeId !== undefined) return placeId;

    const cityName = input.place?.trim() ?? "";
    const stateSlug = input.stateSlug?.trim().toLowerCase() ?? "";
    if (cityName !== "" && stateSlug !== "") {
      const slug = citySlug(cityName);
      const candidates = await readPlacesByStateAndSlug(
        this.context.databaseClient(),
        stateSlug,
        slug,
      );
      if (candidates.length > 0) {
        // Prefer the place in the county the point falls in; else, if the city
        // names exactly one place statewide, use it (the point landed in the
        // wrong county). Multiple same-named places in different counties, none
        // containing the point, stay ambiguous and fail.
        const countyId = await this.uniqueContainingLocationPath(
          input,
          "administrative_area",
        );
        const county =
          countyId === undefined ? undefined : await this.getById(countyId);
        const inCounty =
          county === undefined
            ? undefined
            : candidates.find(
                (candidate) => candidate.path === `${county.path}${slug}/`,
              );
        if (inCounty !== undefined) return inCounty.location_path_id;
        if (candidates.length === 1) return candidates[0]!.location_path_id;
      }
    }

    // The address is the office building's location, so the nearest place is a
    // valid answer when the point is in no place and its city names none (a
    // mis-typed or unincorporated community). Jurisdiction is out of scope.
    if (stateSlug !== "") {
      const nearest = await readNearestPlace(this.context.databaseClient(), {
        latitude: input.latitude,
        longitude: input.longitude,
        stateSlug,
      });
      if (nearest !== undefined) return nearest.location_path_id;
    }

    throw new Error(
      `Cannot resolve a place location_path_id for ${input.subject}: point ${input.latitude}, ${input.longitude} is in no place and ${JSON.stringify(stateSlug)} has no place at all.`,
    );
  }
}
