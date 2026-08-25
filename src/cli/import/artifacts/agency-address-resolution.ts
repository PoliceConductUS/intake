import {
  type AddressResolution,
  type AddressResolutionRequest,
  type LocationResolution,
} from "./location-resolution.js";
import type {
  AgencyCoordinateRequest,
  AgencyCoordinateResolution,
} from "./agency-coordinate-types.js";
import { valueAsString } from "./resolver-kit.js";

export type AgencyAddressResolutionOptions = {
  resolveAgencyCoordinates?: (
    requests: AgencyCoordinateRequest[],
  ) => Promise<AgencyCoordinateResolution[]>;
};

export type ResolveAgencyAddressLocationPath = (input: {
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
}) => Promise<LocationResolution>;

function valueAsFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function valueAtPath(
  value: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = value;
  for (const pathPart of path) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[pathPart];
  }
  return current;
}

function sourceAgencyContext(row: Record<string, unknown>): {
  sourceName?: string;
  messageSuffix: string;
} {
  const sourceName = valueAsString(row.sourceName);
  const agencyName = valueAsString(row.name);
  const address = valueAsString(row.address);
  const city = valueAsString(row.city);
  const state = valueAsString(row.state);
  const zipCode = valueAsString(row.zip_code);
  const stateAndZip =
    state === undefined
      ? zipCode
      : zipCode === undefined
        ? state
        : `${state} ${zipCode}`;
  const locationParts = [address, city, stateAndZip].filter(
    (part): part is string => part !== undefined,
  );
  const detailParts = [
    agencyName,
    locationParts.length > 0 ? locationParts.join(", ") : undefined,
  ].filter((part): part is string => part !== undefined);

  return {
    sourceName,
    messageSuffix:
      sourceName === undefined
        ? ""
        : ` for source agency ${sourceName}${detailParts.length > 0 ? ` (${detailParts.join(", ")})` : ""}`,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function locationDescription(input: AddressResolutionRequest): string {
  const state = valueAsString(input.state);
  const zipCode = valueAsString(input.zipCode);
  const stateAndZip =
    state === undefined
      ? zipCode
      : zipCode === undefined
        ? state
        : `${state} ${zipCode}`;
  return [input.address, input.place, stateAndZip]
    .filter((part): part is string => valueAsString(part) !== undefined)
    .join(", ");
}

export async function resolveImportAddress(
  input: AddressResolutionRequest,
  options: AgencyAddressResolutionOptions,
): Promise<AddressResolution | undefined> {
  if (
    input.entityType !== "agency" ||
    options.resolveAgencyCoordinates === undefined
  ) {
    return undefined;
  }

  const inputLatitude = valueAsFiniteNumber(input.latitude);
  const inputLongitude = valueAsFiniteNumber(input.longitude);
  if (inputLatitude !== undefined && inputLongitude !== undefined) {
    return { latitude: inputLatitude, longitude: inputLongitude };
  }

  // Coordinates are cached and seeded by the facade's PropertyCache (ADR 0019);
  // this is the live geocode on a cache miss.
  const [coordinateResolution] = await options.resolveAgencyCoordinates([
    coordinateRequest(input),
  ]);
  if (
    coordinateResolution === undefined ||
    !Number.isFinite(coordinateResolution.latitude) ||
    !Number.isFinite(coordinateResolution.longitude)
  ) {
    throw new Error(
      `Cannot resolve coordinates for public.agency ${input.entityId} from ${locationDescription(input)}.`,
    );
  }
  return {
    latitude: coordinateResolution.latitude,
    longitude: coordinateResolution.longitude,
  };
}

function coordinateRequest(
  input: AddressResolutionRequest,
): AgencyCoordinateRequest {
  return {
    rowId: input.entityId,
    sourceName: input.sourceName,
    name: input.name ?? input.place,
    address: input.address,
    city: input.place,
    state: input.state,
    zipCode: input.zipCode,
  };
}

export async function resolveAgencyLocationPathId(
  row: Record<string, unknown>,
  resolveAddress: ResolveAgencyAddressLocationPath,
  preferredLocationPathId?: string,
): Promise<string> {
  const rowId = valueAsString(row.id);
  const city = valueAsString(row.city);
  const state = valueAsString(row.state);
  const zipCode = valueAsString(row.zip_code);
  const address = valueAsString(row.address);
  if (
    rowId === undefined ||
    city === undefined ||
    state === undefined ||
    zipCode === undefined ||
    address === undefined
  ) {
    throw new Error(
      `Cannot resolve location_path_id for public.agency ${String(row.id)} without id, address, city, state, and zip_code.`,
    );
  }

  let resolution;
  try {
    resolution = await resolveAddress({
      entityType: "agency",
      entityId: rowId,
      state,
      place: city,
      zipCode,
      address,
      administrativeAreaName: valueAsString(
        valueAtPath(row, ["location", "administrativeAreaName"]),
      ),
      administrativeAreaSlug: valueAsString(
        valueAtPath(row, ["location", "administrativeAreaSlug"]),
      ),
      latitude: valueAsFiniteNumber(row.latitude),
      longitude: valueAsFiniteNumber(row.longitude),
      name: valueAsString(row.name),
      sourceName: valueAsString(row.sourceName),
      preferredLocationPathId,
    });
  } catch (error) {
    const agencyContext = sourceAgencyContext(row);
    throw new Error(
      `Cannot resolve address for public.agency ${rowId}${agencyContext.messageSuffix}: ${errorMessage(error)}`,
    );
  }
  if (valueAsFiniteNumber(row.latitude) === undefined) {
    row.latitude = resolution.addressLatitude;
  }
  if (valueAsFiniteNumber(row.longitude) === undefined) {
    row.longitude = resolution.addressLongitude;
  }
  return resolution.locationPathId;
}
