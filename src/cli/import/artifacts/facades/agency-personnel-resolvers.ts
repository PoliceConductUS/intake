import {
  Resolver,
  valueAsString,
  type FacadeSource,
  type PropertyResolutionFacade,
  type ResolverContext,
} from "../resolver-kit.js";

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
  }): Promise<void>;
  existingRow(id: string): Promise<Record<string, unknown> | undefined>;
};

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

/** Resolve canonical URL identity before considering a new intake-owned slug. */
function slugResolver(
  kind: string,
  deriveBase: (
    facade: PropertyResolutionFacade<Row>,
    id: string,
    source: FacadeSource,
  ) => string,
): Resolver<string, ResolverContext<Row, SlugBackend>> {
  return new Resolver(async ({ facade, source, backend, cache, current }) => {
    const id = String(await facade.value("id"));
    const key = { kind, id, property: "slug" };
    const cached = await cache?.read(key);
    if (
      cached !== undefined &&
      (typeof cached !== "string" || cached.trim() === "")
    ) {
      throw new Error(`Invalid canonical slug cache for ${kind} ${id}.`);
    }
    const row = current ?? (await backend.existingRow(id));
    const databaseSlug =
      row === undefined ? undefined : valueAsString(row.slug);
    if (
      cached !== undefined &&
      databaseSlug !== undefined &&
      cached !== databaseSlug
    ) {
      throw new Error(
        `Canonical slug conflict for ${kind} ${id}: cache ${cached} differs from database ${databaseSlug}.`,
      );
    }
    const established = databaseSlug ?? cached;
    const slug =
      established ??
      (await backend.ensureUniqueSlug({
        kind,
        base: deriveBase(facade, id, source),
        canonicalId: id,
      }));
    await backend.registerSlug({ kind, slug, canonicalId: id });
    if (cached === undefined) {
      await cache?.write(
        { ...key, source: { namespace: source.namespace, name: source.name } },
        slug,
      );
    }
    return slug;
  });
}

/** Other slug-bearing entities use their reader-facing title or name. */
export function entitySlugResolver(
  kind: string,
  field: "title" | "name",
): Resolver<string, ResolverContext<Row, SlugBackend>> {
  return slugResolver(kind, (facade, _id, source) => {
    const value = valueAsString(facade.raw(field));
    if (value === undefined) {
      throw new Error(
        `Cannot generate slug for ${kind} ${source.namespace}/${source.name}; ${field} is required.`,
      );
    }
    return slugify(value);
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
