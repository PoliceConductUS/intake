import { lowerCaseEmail, nameCase, titleCase } from "./case-normalization.js";

// --- ADR 0016: composable per-property resolvers — generic kit ---------------
//
// The entity-agnostic core of the resolver mechanism: a `Resolver` derives one
// property before a database write, handed a context (the source facade to
// `await` sibling properties, the source identity, and the injected backend it
// needs) and returning a `Promise` typed to its target column. Per-entity row
// shapes, backends, and resolvers live in the individual facade modules; only
// the shared primitives live here so every facade composes from the same kit.

/** A facade that exposes its properties through the generic async accessor. */
export interface PropertyResolutionFacade<Row> {
  value<K extends keyof Row>(property: K): Promise<Row[K]>;
  raw(property: keyof Row): unknown;
}

/**
 * A minimal id-resolvable reference returned by the DataContext same-source
 * foreign-key find (ADR 0016 #4). A FK resolver locates the target facade for a
 * source id and `await`s its `id`; a missing target is a forward-reference
 * violation that fails fast and loud (never a minted stub).
 */
export interface ForeignKeyIdSource {
  value(property: "id"): Promise<string>;
}

type ResolverPolicy<T> =
  | { readonly defaultValue: T }
  | { readonly exception: Error }
  | Record<string, never>;

/**
 * A per-property resolver. Constructed with **exactly one** unresolved-policy —
 * a default value OR an exception — or neither. Behavior: resolves → return the
 * value; else throw the configured exception; else return the configured
 * default; else fail fast and loud with a message that locates the record in
 * the source data (`namespace`, `kind`, `source-id`, `property`, offending
 * value), supplied by the caller's `locate` closure.
 */
export class Resolver<T, Ctx> {
  constructor(
    private readonly resolveFn: (context: Ctx) => Promise<T | undefined>,
    private readonly policy: ResolverPolicy<T> = {},
    /**
     * The normalized input this resolver derives its value from — the only thing
     * that knows what the value depends on is the resolver itself (ADR 0019). The
     * cache keys entries by a fingerprint of this object, so an unchanged input
     * serves the cached value and a changed one re-resolves. Absent ⇒ the property
     * is cached by `(subject, property)` alone (a single legacy value).
     */
    private readonly cacheInputFn?: (
      context: Ctx,
    ) => Promise<unknown> | unknown,
  ) {
    if (Object.keys(policy).length > 1) {
      throw new Error(
        "A resolver is constructed with at most one of defaultValue or exception.",
      );
    }
  }

  get cachesByInput(): boolean {
    return this.cacheInputFn !== undefined;
  }

  async cacheInput(context: Ctx): Promise<unknown | undefined> {
    return this.cacheInputFn === undefined
      ? undefined
      : await this.cacheInputFn(context);
  }

  async resolve(context: Ctx, locate: () => string): Promise<T> {
    const value = await this.resolveFn(context);
    if (value !== undefined) {
      return value;
    }
    if ("exception" in this.policy) {
      throw this.policy.exception;
    }
    if ("defaultValue" in this.policy) {
      return this.policy.defaultValue;
    }
    throw new Error(locate());
  }
}

/** Identity of the source record a facade resolves for (error context + FK keys). */
export type FacadeSource = {
  namespace: string;
  name: string;
  canonicalId?: string;
  commandName?: string;
  /** Absolute path of the file this record was read from (for error context). */
  sourceFile?: string;
};

/**
 * The uniform interface a resolver uses to reach the facade it is attached to,
 * the source identity, and the injected backend. Backend is a parameter so each
 * entity's resolvers carry exactly the capabilities they reach through.
 */
export type ResolverContext<Row, Backend> = {
  facade: PropertyResolutionFacade<Row>;
  source: FacadeSource;
  backend: Backend;
};

/**
 * A persistent, resolver-agnostic property cache keyed by `(entity kind, subject
 * id, property)`. It backs both seeding and geocode reuse: a resolver-backed
 * property whose source value is absent is read from here before it is resolved
 * live, and a live resolution is written back. Source-provided values are never
 * written (the source is authoritative and re-read each run). Seed files are the
 * same cache under version control.
 */
export interface PropertyCache {
  read(key: {
    kind: string;
    id: string;
    property: string;
    inputFingerprint?: string;
  }): Promise<unknown | undefined>;
  write(
    key: {
      kind: string;
      id: string;
      property: string;
      inputFingerprint?: string;
      /** The source record that resolved this value (per-entry provenance). */
      source?: { namespace: string; name: string };
    },
    value: unknown,
  ): Promise<void>;
}

/**
 * The durable-ledger capability the resolution chain reaches through: a find-only
 * read (the "db source" link — resolve-or-fail, never mints) and a find-or-create
 * (the "mint" terminal link, used only when resolving an entity's own identity).
 * Backend-generic so any entity's facade can reuse it.
 */
export type CanonicalIdBackend = {
  /** The recorded canonical id for a source id, or undefined — never mints. */
  findCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string | undefined>;
  findOrCreateCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string>;
};

/**
 * The minimal capability a foreign-key resolver reaches through: locate an
 * already-emitted target facade by `(kind, namespace, source-id)` so it can
 * await the target's `id`. Backend-generic — a facade's fuller backend (which
 * also has canonical-id and current-row lookups) satisfies it structurally.
 */
export type ForeignKeyBackend = {
  findForeignKeyTarget(input: {
    kind: string;
    namespace: string;
    sourceId: string;
  }): ForeignKeyIdSource | undefined;
};

/** Coerce a spec value to a non-blank string, else undefined. */
export function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

/**
 * A resolver composed from sibling properties (ADR 0016): it `await`s the already-
 * resolved values of `from` through the facade — which memoizes, so a shared
 * upstream resolver (e.g. a geocode that sets both `latitude` and `longitude`)
 * runs once — and applies `build` to transform them. This is how one property
 * delegates to another's output (e.g. a GeoJSON point built from resolved
 * coordinates) without recomputing it. `build` returns `null`/`undefined` to defer
 * to the resolver's unresolved policy.
 */
export function composedResolver<T, Row>(
  from: ReadonlyArray<keyof Row & string>,
  build: (values: unknown[]) => T | undefined,
): Resolver<T, ResolverContext<Row, unknown>> {
  return new Resolver(async ({ facade }) => {
    const values = await Promise.all(
      from.map((property) => facade.value(property)),
    );
    return build(values);
  });
}

/**
 * The capability a location_path chain link reaches through: resolve an existing
 * location_path by its path, then alias (resolve-or-fail, never mints).
 */
type LocationPathByPathBackend = {
  getLocationPathByPath(
    path: string,
  ): Promise<{ location_path_id: string } | undefined>;
};

// --- The reference-resolution chain (Chain of Responsibility, ADR 0016/0023) --
//
// Every foreign key and identity resolves a source-supplied REFERENCE to a
// canonical id by walking one standard, ordered chain of links. Each link either
// resolves the reference or defers to the next; a kind differs only in which links
// it composes (config), never in hand-rolled ordering. The chain terminates in
// EITHER a mint link (an entity's own identity — always resolves) OR nothing (a
// foreign key — resolve-or-fail: an unresolved reference throws, never mints).

/** The union backend the standard links reach through. */
type ReferenceBackend = CanonicalIdBackend &
  ForeignKeyBackend &
  LocationPathByPathBackend;

/**
 * One link in the chain: resolve `reference` to a canonical id, or `undefined` to
 * defer to the next link.
 */
export type ReferenceLink<Row> = (
  reference: string,
  context: ResolverContext<Row, ReferenceBackend>,
) => Promise<string | undefined>;

/** Same-run link: a target facade emitted this run resolves to its id. */
export function sameRunLink<Row>(targetKind: string): ReferenceLink<Row> {
  return async (reference, { source, backend }) => {
    const target = backend.findForeignKeyTarget({
      kind: targetKind,
      namespace: source.namespace,
      sourceId: reference,
    });
    return target === undefined ? undefined : target.value("id");
  };
}

/** Db-source link: an existing durable ledger mapping (find-only, never mints). */
export function ledgerFindLink<Row>(targetKind: string): ReferenceLink<Row> {
  return (reference, { source, backend }) =>
    backend.findCanonicalId({
      namespace: source.namespace,
      kind: targetKind,
      sourceId: reference,
    });
}

/** Db-source link for LocationPath: resolve the reference by path, then alias. */
export function locationPathByPathLink<Row>(): ReferenceLink<Row> {
  return async (reference, { backend }) =>
    (await backend.getLocationPathByPath(reference))?.location_path_id;
}

/** Terminal mint link: the durable find-or-create. Only an identity may mint. */
export function ledgerMintLink<Row>(targetKind: string): ReferenceLink<Row> {
  return (reference, { source, backend }) =>
    backend.findOrCreateCanonicalId({
      namespace: source.namespace,
      kind: targetKind,
      sourceId: reference,
    });
}

/**
 * The durable "db source" link for a foreign-key target: by path (then alias) for
 * a LocationPath — which is not ledger-mapped — else the ledger find. This is why
 * a plain FK to a LocationPath composes [same-run, by-path] with no bespoke code.
 */
function foreignKeyDbSourceLink<Row>(targetKind: string): ReferenceLink<Row> {
  return targetKind === "LocationPath"
    ? locationPathByPathLink<Row>()
    : ledgerFindLink<Row>(targetKind);
}

/**
 * Compose a chain of links into a property resolver (ADR 0016/0023). The reference
 * is read via `referenceFrom`; the links are tried in order and the first resolved
 * id wins. An absent reference fails loud (or resolves to null when `optional`); a
 * present-but-unresolved reference fails loud, naming what it points at
 * (`referenceLabel`, e.g. the target kind) and the source file — unless a link
 * mints, in which case the chain always resolves.
 */
export function referenceResolver<Row, T extends string | null = string>(
  entityKind: string,
  property: string,
  referenceLabel: string,
  referenceFrom: (
    context: ResolverContext<Row, ReferenceBackend>,
  ) => string | undefined,
  links: ReadonlyArray<ReferenceLink<Row>>,
  options: { optional?: boolean } = {},
): Resolver<T, ResolverContext<Row, ReferenceBackend>> {
  return new Resolver(async (context) => {
    const { source } = context;
    const reference = referenceFrom(context);
    if (reference === undefined) {
      if (options.optional === true) {
        return null as T;
      }
      throw new Error(
        `Cannot resolve ${entityKind}.${property} for ${source.namespace}/${source.name}; source ${property} is missing.`,
      );
    }
    for (const link of links) {
      const resolved = await link(reference, context);
      if (resolved !== undefined) {
        return resolved as T;
      }
    }
    throw new Error(
      [
        `${entityKind} ${source.namespace}/${source.name} references ${referenceLabel} ${JSON.stringify(
          reference,
        )}, which does not exist in namespace ${source.namespace}.`,
        source.sourceFile && `Source: ${source.sourceFile}.`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  });
}

/**
 * `location_path_id` resolve-or-fail resolver (ADR 0006/0015): the source supplies
 * a namespace-local state value (e.g. "tx"); map it to `/<state>/` and resolve
 * against the imported location hierarchy by path. A standard one-link chain.
 */
export function facadeStateLocationPathResolver<Row>(
  entityKind: string,
): Resolver<string, ResolverContext<Row, ReferenceBackend>> {
  return referenceResolver<Row, string>(
    entityKind,
    "location_path_id",
    "LocationPath",
    ({ facade }) => {
      const state = valueAsString(facade.raw("location_path_id" as keyof Row));
      return state === undefined ? undefined : `/${state.toLowerCase()}/`;
    },
    [locationPathByPathLink()],
  );
}

/**
 * Canonical-id resolver for an entity's own identity (ADR 0016 #4): a single mint
 * terminal — find the seeded/existing id, else mint — so it always resolves.
 */
export function facadeCanonicalIdResolver<Row>(
  kind: string,
): Resolver<string, ResolverContext<Row, ReferenceBackend>> {
  return referenceResolver<Row, string>(
    kind,
    "id",
    kind,
    ({ source }) => source.name,
    [ledgerMintLink(kind)],
  );
}

/**
 * Foreign-key resolver (ADR 0016/0023): the standard chain — a same-run co-emitted
 * facade, then the durable db source (the ledger, or by-path for a LocationPath) —
 * resolve-or-fail. Never mints (a foreign key has no mint terminal).
 */
export function facadeForeignKeyResolver<Row>(
  entityKind: string,
  property: keyof Row & string,
  targetKind: string,
): Resolver<string, ResolverContext<Row, ReferenceBackend>> {
  return referenceResolver<Row, string>(
    entityKind,
    property,
    targetKind,
    ({ facade }) => valueAsString(facade.raw(property)),
    [sameRunLink(targetKind), foreignKeyDbSourceLink(targetKind)],
  );
}

/**
 * Composed natural-key id (ADR 0028): the entity's id is the `|`-joined resolved
 * values of the given properties — typically its foreign keys — so records that
 * resolve to the same targets converge on one row across sources (e.g. the same
 * officer named in the same case by two sources). Each property resolves through
 * the normal path (an FK resolves to its target's canonical id), so the id
 * depends on those FKs — a legal ordering, since no FK depends on the id.
 */
export function facadeComposedIdResolver<Row>(
  properties: ReadonlyArray<keyof Row & string>,
): Resolver<string, ResolverContext<Row, unknown>> {
  return new Resolver(async ({ facade }) => {
    const segments: string[] = [];
    for (const property of properties) {
      const value = valueAsString(await facade.value(property));
      if (value === undefined) {
        throw new Error(
          `Cannot compose id: ${String(property)} resolved to no value.`,
        );
      }
      segments.push(value);
    }
    return segments.join("|");
  });
}

/**
 * Cross-source foreign-key resolver (ADR 0023): the referenced entity was created
 * by another source, so its source id resolves through the durable ledger (the
 * source minted the mapping via `sourceIdFor` before emitting). It is the standard
 * FK chain — same-run, then ledger find — resolve-or-fail; it never mints a phantom
 * canonical. Identical to `facadeForeignKeyResolver` for a ledger-mapped target; the
 * distinct name documents the cross-source intent at the call site.
 */
export function facadeLedgerForeignKeyResolver<Row>(
  entityKind: string,
  property: keyof Row & string,
  targetKind: string,
): Resolver<string, ResolverContext<Row, ReferenceBackend>> {
  return facadeForeignKeyResolver<Row>(entityKind, property, targetKind);
}

/**
 * Nullable foreign-key resolver (ADR 0016 #4/#9). The standard FK chain, but an
 * absent source reference resolves to `null` (the FK is optional per the source
 * spec) rather than failing; a present-but-unresolved reference still fails loud.
 */
export function facadeNullableForeignKeyResolver<Row>(
  entityKind: string,
  property: keyof Row & string,
  targetKind: string,
): Resolver<string | null, ResolverContext<Row, ReferenceBackend>> {
  return referenceResolver<Row, string | null>(
    entityKind,
    property,
    targetKind,
    ({ facade }) => valueAsString(facade.raw(property)),
    [sameRunLink(targetKind), foreignKeyDbSourceLink(targetKind)],
    { optional: true },
  );
}

/**
 * Build the shared casing resolveFn: read the source string at `property`, apply
 * `transform`, or resolve to `undefined` when the source value is absent — so the
 * resolver's nullability policy (a `null` default for nullable columns, fail-loud
 * for required ones) decides the outcome. Casing runs through the facade, never a
 * pre-DB transform (the forbidden pattern).
 */
function casingResolveFn<Row, Backend>(
  property: keyof Row & string,
  transform: (value: string) => string,
): (context: ResolverContext<Row, Backend>) => Promise<string | undefined> {
  return async ({ facade }) => {
    const raw = valueAsString(facade.raw(property));
    return raw === undefined ? undefined : transform(raw);
  };
}

/** Title-case an organization/address string property (REQUIRED column). */
export function titleCaseResolver<Row, Backend>(
  property: keyof Row & string,
): Resolver<string, ResolverContext<Row, Backend>> {
  return new Resolver<string, ResolverContext<Row, Backend>>(
    casingResolveFn<Row, Backend>(property, titleCase),
  );
}

/** Name-case a person-name string property (REQUIRED column). */
export function nameCaseResolver<Row, Backend>(
  property: keyof Row & string,
): Resolver<string, ResolverContext<Row, Backend>> {
  return new Resolver<string, ResolverContext<Row, Backend>>(
    casingResolveFn<Row, Backend>(property, nameCase),
  );
}

/** Name-case a person-name string property (NULLABLE column). */
export function nameCaseResolverNullable<Row, Backend>(
  property: keyof Row & string,
): Resolver<string | null, ResolverContext<Row, Backend>> {
  return new Resolver<string | null, ResolverContext<Row, Backend>>(
    casingResolveFn<Row, Backend>(property, nameCase),
    { defaultValue: null },
  );
}

/** Lowercase an email string property (NULLABLE column). */
export function lowerCaseEmailResolverNullable<Row, Backend>(
  property: keyof Row & string,
): Resolver<string | null, ResolverContext<Row, Backend>> {
  return new Resolver<string | null, ResolverContext<Row, Backend>>(
    casingResolveFn<Row, Backend>(property, lowerCaseEmail),
    { defaultValue: null },
  );
}
