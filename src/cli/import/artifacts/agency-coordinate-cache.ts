import { INTAKE_API_VERSION } from "../../../shared/io/import-types.js";
import {
  type ResolvedPropertyCacheInput,
  typedInputFingerprint,
} from "../../state/resolved-property/index.js";
import type {
  AgencyCoordinateRequest,
  AgencyCoordinateResolution,
} from "./agency-coordinate-types.js";

export type AgencyCoordinateCacheOptions = {
  sourceNamespace?: string;
  resolvedPropertyCache?: {
    read(input: ResolvedPropertyCacheInput): Promise<unknown | undefined>;
    write(
      input: ResolvedPropertyCacheInput & { value: unknown },
    ): Promise<void>;
  };
};

export type CachedAgencyCoordinateResolution = {
  status: "resolved";
  resolution: AgencyCoordinateResolution;
};

export function coordinateResolverInput(request: AgencyCoordinateRequest): {
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
} {
  return {
    name: request.name,
    address: request.address,
    city: request.city,
    state: request.state,
    zipCode: request.zipCode,
  };
}

export function agencyCoordinateCacheInput(
  request: AgencyCoordinateRequest,
  targetProperty: "latitude" | "longitude" | "location_path_id",
  options: AgencyCoordinateCacheOptions,
): ResolvedPropertyCacheInput | undefined {
  if (
    options.sourceNamespace === undefined ||
    request.sourceName === undefined
  ) {
    return undefined;
  }

  return {
    subject: {
      apiVersion: INTAKE_API_VERSION,
      kind: "Agency",
      name: request.rowId,
    },
    targetProperty,
    source: {
      namespace: options.sourceNamespace,
      kind: "Agency",
      name: request.sourceName,
      inputFingerprint: typedInputFingerprint(coordinateResolverInput(request)),
    },
  };
}

export async function cachedAgencyCoordinateResolution(
  request: AgencyCoordinateRequest,
  options: AgencyCoordinateCacheOptions,
): Promise<CachedAgencyCoordinateResolution | undefined> {
  if (options.resolvedPropertyCache === undefined) {
    return undefined;
  }

  const latitudeInput = agencyCoordinateCacheInput(
    request,
    "latitude",
    options,
  );
  const longitudeInput = agencyCoordinateCacheInput(
    request,
    "longitude",
    options,
  );
  if (latitudeInput === undefined || longitudeInput === undefined) {
    return undefined;
  }

  const [latitude, longitude] = await Promise.all([
    options.resolvedPropertyCache.read(latitudeInput),
    options.resolvedPropertyCache.read(longitudeInput),
  ]);
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude)
  ) {
    return undefined;
  }

  return {
    status: "resolved",
    resolution: {
      rowId: request.rowId,
      latitude,
      longitude,
    },
  };
}

export async function writeAgencyCoordinateResolutionCache(
  request: AgencyCoordinateRequest,
  resolution: AgencyCoordinateResolution,
  options: AgencyCoordinateCacheOptions,
): Promise<void> {
  if (options.resolvedPropertyCache === undefined) {
    return;
  }

  const latitudeInput = agencyCoordinateCacheInput(
    request,
    "latitude",
    options,
  );
  const longitudeInput = agencyCoordinateCacheInput(
    request,
    "longitude",
    options,
  );
  if (latitudeInput === undefined || longitudeInput === undefined) {
    return;
  }

  await options.resolvedPropertyCache.write({
    ...latitudeInput,
    value: resolution.latitude,
  });
  await options.resolvedPropertyCache.write({
    ...longitudeInput,
    value: resolution.longitude,
  });
}
