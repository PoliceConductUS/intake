import {
  type AddressResolution,
  type AddressResolutionRequest,
} from "./location-resolution.js";
import type {
  AgencyCoordinateRequest,
  AgencyCoordinateResolution,
} from "./agency-coordinate-types.js";
import { valueAsString } from "./resolver-kit.js";
import { UnresolvedPropertiesError } from "./property-resolution-error.js";

export type AgencyAddressResolutionOptions = {
  resolveAgencyCoordinates?: (
    requests: AgencyCoordinateRequest[],
  ) => Promise<AgencyCoordinateResolution[]>;
};

function valueAsFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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
  // The coordinate resolver is a generic geocoder (address → point); any
  // address-bearing entity uses it — agency and review alike (ADR 0030). Absent a
  // geocoder there is nothing to resolve.
  if (options.resolveAgencyCoordinates === undefined) {
    return undefined;
  }

  const inputLatitude = valueAsFiniteNumber(input.latitude);
  const inputLongitude = valueAsFiniteNumber(input.longitude);
  if (inputLatitude !== undefined && inputLongitude !== undefined) {
    return { latitude: inputLatitude, longitude: inputLongitude };
  }

  // Coordinates are cached and manually corrected through the CLI by the facade's PropertyCache (ADR 0019);
  // this is the live geocode on a cache miss.
  const [coordinateResolution] = await options.resolveAgencyCoordinates([
    coordinateRequest(input),
  ]);
  if (
    coordinateResolution === undefined ||
    !Number.isFinite(coordinateResolution.latitude) ||
    !Number.isFinite(coordinateResolution.longitude)
  ) {
    throw new UnresolvedPropertiesError(
      `Cannot resolve coordinates for ${input.entityType} ${input.entityId}; source-id=${JSON.stringify(input.sourceName)}; name=${JSON.stringify(input.name)}; address=${locationDescription(input)}.\nAddress geocoding returned no usable coordinates. Supply verified latitude and longitude for the physical location. Setting location_path_id alone does not supply coordinates.`,
      ["latitude", "longitude"],
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
