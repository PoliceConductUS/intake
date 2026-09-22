import { valueAsString } from "./resolver-kit.js";
import {
  readLocationPathAliasByPath,
  readLocationPathById,
  readLocationPathByPath,
  readLocationPathsContainingPoint,
  type DatabaseLocationPathRow as LocationPathRow,
} from "../../database/location-paths.js";
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
};

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

  const sourceName = valueAsString(input.sourceName);
  const name = valueAsString(input.name);
  const administrativeAreaName = valueAsString(input.administrativeAreaName);
  const administrativeAreaSlug = valueAsString(input.administrativeAreaSlug);
  return {
    entityType: input.entityType,
    entityId: input.entityId,
    ...(sourceName === undefined ? {} : { sourceName }),
    ...(name === undefined ? {} : { name }),
    address: input.address!,
    place: input.place!,
    state: input.state!,
    zipCode: input.zipCode!,
    ...(administrativeAreaName === undefined ? {} : { administrativeAreaName }),
    ...(administrativeAreaSlug === undefined ? {} : { administrativeAreaSlug }),
    ...(Number.isFinite(input.latitude) ? { latitude: input.latitude } : {}),
    ...(Number.isFinite(input.longitude) ? { longitude: input.longitude } : {}),
  };
}

/** Geocodes an address to a canonical location: geocode → point-in-boundary. */
export class LocationDataContext {
  constructor(private readonly context: DataContext) {}

  async resolveCoordinates(
    input: ResolveAddressInput,
  ): Promise<AddressResolution> {
    const request = addressResolutionRequest(input);
    const coordinates = await this.context.resolveAddress(request);
    if (coordinates === undefined) {
      throw new Error(
        `Cannot resolve address for ${request.entityType} ${request.entityId}.`,
      );
    }
    return coordinates;
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

    const addressResolution = await this.resolveCoordinates(request);

    const locationPathId =
      await this.context.locationPaths.getPlaceContainingPoint({
        latitude: addressResolution.latitude,
        longitude: addressResolution.longitude,
        subject: `${request.entityType} ${request.entityId}; source ${request.sourceName ?? request.entityId}; name ${JSON.stringify(request.name)}; address ${JSON.stringify(request.address)}, ${JSON.stringify(request.place)}, ${request.state} ${request.zipCode}`,
      });
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
    level: "place",
  ): Promise<string | undefined> {
    const matches = await readLocationPathsContainingPoint(
      this.context.databaseClient(),
      { latitude: input.latitude, longitude: input.longitude, level },
    );
    if (matches.length === 0) return undefined;
    const resolutionClasses = [
      "primary",
      "county_subdivision",
      "consolidated_city",
    ];
    const winningClass = resolutionClasses.find((kind) =>
      matches.some((row) => row.resolution_class === kind),
    );
    if (winningClass === undefined)
      throw new Error(`Missing location resolution class for ${input.subject}`);
    const preferredMatches = matches.filter(
      (row) => row.resolution_class === winningClass,
    );
    const uniqueMatches = [
      ...new Map(
        preferredMatches.map((locationPath) => [
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

  // ADR 0024: resolve the containing place or fail.
  async getPlaceContainingPoint(input: {
    latitude: number;
    longitude: number;
    subject: string;
  }): Promise<string> {
    const placeId = await this.uniqueContainingLocationPath(input, "place");
    if (placeId !== undefined) return placeId;
    throw new Error(
      `Cannot resolve location_path_id for ${input.subject}; no place location_path_geometry boundary contains point ${input.latitude}, ${input.longitude}.`,
    );
  }
}
