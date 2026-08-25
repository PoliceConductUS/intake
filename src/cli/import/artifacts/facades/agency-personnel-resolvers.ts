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
} from "../data-context.js";

// The Agency and Personnel resolvers operate on a plain string-keyed row so they
// slot into the generic registry; their specific column types are erased there.
type Row = Record<string, unknown>;

/**
 * The generic slug capability a slug resolver reaches through (no per-entity
 * method names): ensure a base slug is unique for a kind and register a claim so
 * a later generated slug in the same command disambiguates away from it.
 */
export type SlugBackend = {
  ensureUniqueSlug(input: {
    kind: string;
    base: string;
    canonicalId: string;
  }): Promise<string>;
  registerSlug(input: {
    kind: string;
    slug: string;
    canonicalId: string;
  }): void;
  existingRow(id: string): Promise<Record<string, unknown> | undefined>;
};

/** The capability the agency location/coordinate resolvers reach through. */
export type AgencyLocationBackend = {
  resolveAgencyLocation(input: ResolveAddressInput): Promise<LocationResolution>;
  existingRow(id: string): Promise<Record<string, unknown> | undefined>;
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

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "record"
  );
}

function canonicalSuffix(id: unknown): string {
  const normalized = String(id)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  return normalized.slice(-6) || "record";
}

/**
 * The shared slug flow (ADR 0016 #4): an explicitly-supplied slug wins, else the
 * existing DB row's slug is reused (so a corrected name keeps the slug stable),
 * else a base is derived and disambiguated to be unique. `deriveBase` is the only
 * per-entity part.
 */
function slugResolver(
  kind: string,
  deriveBase: (
    facade: PropertyResolutionFacade<Row>,
    id: string,
    source: FacadeSource,
  ) => string,
): Resolver<string, ResolverContext<Row, SlugBackend>> {
  return new Resolver(async ({ facade, source, backend }) => {
    const id = String(await facade.value("id"));
    const explicit = valueAsString(facade.raw("slug"));
    if (explicit !== undefined) {
      backend.registerSlug({ kind, slug: explicit, canonicalId: id });
      return explicit;
    }
    const current = await backend.existingRow(id);
    const currentSlug =
      current === undefined ? undefined : valueAsString(current.slug);
    if (currentSlug !== undefined) {
      backend.registerSlug({ kind, slug: currentSlug, canonicalId: id });
      return currentSlug;
    }
    const base = deriveBase(facade, id, source);
    return backend.ensureUniqueSlug({ kind, base, canonicalId: id });
  });
}

/** Generate-unique slug resolver for Personnel (name + canonical-id suffix). */
export function personnelSlugResolver(): Resolver<
  string,
  ResolverContext<Row, SlugBackend>
> {
  return slugResolver("Personnel", (facade, id, source) => {
    const firstName = valueAsString(facade.raw("first_name"));
    if (firstName === undefined) {
      throw new Error(
        `Cannot generate slug for Personnel ${source.namespace}/${source.name}; first_name is required.`,
      );
    }
    // last_name is optional (some officers have no last name in the source).
    const lastName = valueAsString(facade.raw("last_name"));
    const fullName =
      lastName === undefined ? firstName : `${firstName} ${lastName}`;
    return `${slugify(fullName)}-${canonicalSuffix(id)}`;
  });
}

/** Generate-unique slug resolver for Agency (slugified name). */
export function agencySlugResolver(): Resolver<
  string,
  ResolverContext<Row, SlugBackend>
> {
  return slugResolver("Agency", (facade, _id, source) => {
    const name = valueAsString(facade.raw("name"));
    if (name === undefined) {
      throw new Error(
        `Cannot generate slug for Agency ${source.namespace}/${source.name}; name is required.`,
      );
    }
    return slugify(name);
  });
}

function agencyAddressInput(
  facade: PropertyResolutionFacade<Row>,
  source: FacadeSource,
): ResolveAddressInput {
  const location = valueAsRecordOrUndefined(facade.raw("location")) ?? {};
  return {
    entityType: "agency",
    entityId: source.name,
    state: valueAsString(facade.raw("state")),
    place: valueAsString(facade.raw("city")),
    zipCode: valueAsString(facade.raw("zip_code")),
    address: valueAsString(facade.raw("address")),
    administrativeAreaName: valueAsString(location.administrativeAreaName),
    administrativeAreaSlug: valueAsString(location.administrativeAreaSlug),
    latitude: valueAsFiniteNumber(facade.raw("latitude")),
    longitude: valueAsFiniteNumber(facade.raw("longitude")),
    name: valueAsString(facade.raw("name")),
    sourceName: source.name,
  };
}

/** `location_path_id` composition resolver (resolve-or-fail, ADR 0006/0015). */
export function agencyLocationPathResolver(): Resolver<
  string,
  ResolverContext<Row, AgencyLocationBackend>
> {
  return new Resolver(async ({ facade, backend, source }) => {
    const present = valueAsString(facade.raw("location_path_id"));
    if (present !== undefined) {
      return present;
    }
    // Stability: an existing agency keeps its current location rather than being
    // re-geocoded on update.
    const id = String(await facade.value("id"));
    const current = await backend.existingRow(id);
    const currentValue =
      current === undefined
        ? undefined
        : valueAsString(current.location_path_id);
    if (currentValue !== undefined) {
      return currentValue;
    }
    const resolution = await backend.resolveAgencyLocation(
      agencyAddressInput(facade, source),
    );
    return resolution.locationPathId;
  });
}

/** `latitude`/`longitude` resolver: reuse source/existing, else the geocode. */
export function agencyCoordinateResolver(
  field: "addressLatitude" | "addressLongitude",
  column: "latitude" | "longitude",
): Resolver<number, ResolverContext<Row, AgencyLocationBackend>> {
  return new Resolver(async ({ facade, backend, source }) => {
    const present = valueAsFiniteNumber(facade.raw(column));
    if (present !== undefined) {
      return present;
    }
    const id = String(await facade.value("id"));
    const current = await backend.existingRow(id);
    const currentValue =
      current === undefined ? undefined : valueAsFiniteNumber(current[column]);
    if (currentValue !== undefined) {
      return currentValue;
    }
    const resolution = await backend.resolveAgencyLocation(
      agencyAddressInput(facade, source),
    );
    return resolution[field];
  });
}
