import {
  Resolver,
  valueAsString,
  type FacadeSource,
  type PropertyResolutionFacade,
  type ResolverContext,
} from "../resolver-kit.js";
import type {
  LocationResolution,
  ResolveAddressInput,
} from "../location-resolution.js";

type Row = Record<string, unknown>;

/** The capability the geocode resolvers reach through (entity-independent). */
export type LocationBackend = {
  resolveAgencyLocation(
    input: ResolveAddressInput,
  ): Promise<LocationResolution>;
  existingRow(id: string): Promise<Record<string, unknown> | undefined>;
};

/**
 * Entity-independent geocode configuration: the fields to READ off the record to
 * build the address, and the columns to SET from one geocode. See
 * `latLngFromAddress`.
 */
export type GeocodeConfig = {
  /** Passed through to the backend's address resolution (branch/telemetry). */
  entityType: string;
  /** Identity column used for existing-row stability lookups (default `id`). */
  identity?: string;
  /** Record fields the address is read from. */
  from: {
    state: string;
    place: string;
    zipCode: string;
    address: string;
    /** Optional display name field, and an optional nested location object with
     * `administrativeAreaName`/`administrativeAreaSlug`. */
    name?: string;
    location?: string;
  };
  /** Columns this one geocode sets. */
  set: {
    latitude: string;
    longitude: string;
    locationPathId: string;
  };
};

function valueAsFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function valueAsRecordOrUndefined(
  value: unknown,
): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeToken(value: string | undefined): string | undefined {
  return value === undefined
    ? undefined
    : value.trim().toLowerCase().replace(/\s+/g, " ");
}

function addressInput(
  facade: PropertyResolutionFacade<Row>,
  source: FacadeSource,
  config: GeocodeConfig,
): ResolveAddressInput {
  const location =
    config.from.location === undefined
      ? {}
      : (valueAsRecordOrUndefined(facade.raw(config.from.location)) ?? {});
  return {
    entityType: config.entityType,
    entityId: source.name,
    state: valueAsString(facade.raw(config.from.state)),
    place: valueAsString(facade.raw(config.from.place)),
    zipCode: valueAsString(facade.raw(config.from.zipCode)),
    address: valueAsString(facade.raw(config.from.address)),
    administrativeAreaName: valueAsString(location.administrativeAreaName),
    administrativeAreaSlug: valueAsString(location.administrativeAreaSlug),
    // No latitude/longitude here: reading them raw would bypass the cache. The
    // shared resolve passes resolved coordinates explicitly; the backend geocodes
    // when they are absent.
    name:
      config.from.name === undefined
        ? undefined
        : valueAsString(facade.raw(config.from.name)),
    sourceName: source.name,
  };
}

// The normalized geocode input the coordinate columns cache by (ADR 0019): the
// address fields only, so an unchanged address serves the cached coordinate.
function coordinateCacheInput(
  facade: PropertyResolutionFacade<Row>,
  source: FacadeSource,
  config: GeocodeConfig,
): Record<string, string | undefined> {
  const address = addressInput(facade, source, config);
  return {
    state: normalizeToken(address.state),
    city: normalizeToken(address.place),
    zipCode: normalizeToken(address.zipCode),
    address: normalizeToken(address.address),
    administrativeAreaName: normalizeToken(address.administrativeAreaName),
    administrativeAreaSlug: normalizeToken(address.administrativeAreaSlug),
  };
}

/**
 * One geocode that sets `latitude`, `longitude`, and `location_path_id` (ADR
 * 0006/0015/0019), entity-independent. Returns a resolver per output column; each
 * is `source value > existing row (stability) > the shared geocode`, and the
 * geocode runs at most once per record — memoized on the facade — so asking for a
 * second output never re-runs it. `location_path_id` rides along in the same
 * `LocationResolution` (it needs the address, not just the coordinates). A GeoJSON
 * point is layered on top with `composedResolver` over the resolved coordinates.
 */
export function latLngFromAddress(
  config: GeocodeConfig,
): Record<string, Resolver<unknown, ResolverContext<Row, LocationBackend>>> {
  const identity = config.identity ?? "id";
  const shared = new WeakMap<object, Promise<LocationResolution>>();

  const resolveShared = (
    context: ResolverContext<Row, LocationBackend>,
  ): Promise<LocationResolution> => {
    const key = context.facade as object;
    const cached = shared.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const pending = (async () => {
      const { facade, source, backend } = context;
      const id = String(await facade.value(identity));
      const existing = await backend.existingRow(id);
      // Reuse already-known coordinates (source, then existing row) so the path
      // snaps to them rather than re-geocoding the address independently.
      const latitude =
        valueAsFiniteNumber(facade.raw(config.set.latitude)) ??
        (existing === undefined
          ? undefined
          : valueAsFiniteNumber(existing[config.set.latitude]));
      const longitude =
        valueAsFiniteNumber(facade.raw(config.set.longitude)) ??
        (existing === undefined
          ? undefined
          : valueAsFiniteNumber(existing[config.set.longitude]));
      return backend.resolveAgencyLocation({
        ...addressInput(facade, source, config),
        latitude,
        longitude,
      });
    })();
    shared.set(key, pending);
    return pending;
  };

  const coordinateResolver = (
    field: "addressLatitude" | "addressLongitude",
    column: string,
  ): Resolver<number, ResolverContext<Row, LocationBackend>> =>
    new Resolver(
      async (context) => {
        const { facade, backend } = context;
        const present = valueAsFiniteNumber(facade.raw(column));
        if (present !== undefined) {
          return present;
        }
        const id = String(await facade.value(identity));
        const existing = await backend.existingRow(id);
        const current =
          existing === undefined
            ? undefined
            : valueAsFiniteNumber(existing[column]);
        if (current !== undefined) {
          return current;
        }
        return (await resolveShared(context))[field];
      },
      {},
      ({ facade, source }) => coordinateCacheInput(facade, source, config),
    );

  const locationPathResolver = (): Resolver<
    string,
    ResolverContext<Row, LocationBackend>
  > =>
    new Resolver(
      async (context) => {
        const { facade, backend } = context;
        const present = valueAsString(facade.raw(config.set.locationPathId));
        if (present !== undefined) {
          return present;
        }
        const id = String(await facade.value(identity));
        const existing = await backend.existingRow(id);
        const current =
          existing === undefined
            ? undefined
            : valueAsString(existing[config.set.locationPathId]);
        if (current !== undefined) {
          return current;
        }
        return (await resolveShared(context)).locationPathId;
      },
      {},
      async ({ facade }) => ({
        latitude: valueAsFiniteNumber(await facade.value(config.set.latitude)),
        longitude: valueAsFiniteNumber(
          await facade.value(config.set.longitude),
        ),
        city: normalizeToken(valueAsString(facade.raw(config.from.place))),
        state: normalizeToken(valueAsString(facade.raw(config.from.state))),
      }),
    );

  return {
    [config.set.latitude]: coordinateResolver(
      "addressLatitude",
      config.set.latitude,
    ),
    [config.set.longitude]: coordinateResolver(
      "addressLongitude",
      config.set.longitude,
    ),
    [config.set.locationPathId]: locationPathResolver(),
  } as Record<string, Resolver<unknown, ResolverContext<Row, LocationBackend>>>;
}
