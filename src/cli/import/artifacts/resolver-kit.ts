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
  ) {
    if (Object.keys(policy).length > 1) {
      throw new Error(
        "A resolver is constructed with at most one of defaultValue or exception.",
      );
    }
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
 * The minimal capability a canonical-id resolver reaches through: the durable
 * ledger find-or-create. Backend-generic so any entity's facade can reuse it.
 */
export type CanonicalIdBackend = {
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

/** Canonical-id find-or-create resolver for an entity `kind` (ADR 0016 #4). */
export function facadeCanonicalIdResolver<
  Row,
  Backend extends CanonicalIdBackend = CanonicalIdBackend,
>(kind: string): Resolver<string, ResolverContext<Row, Backend>> {
  return new Resolver(async ({ source, backend }) =>
    backend.findOrCreateCanonicalId({
      namespace: source.namespace,
      kind,
      sourceId: source.name,
    }),
  );
}

/**
 * Same-source foreign-key FIND resolver (ADR 0016 #4/#9). Reads the source-local
 * reference value from `property`, locates the target facade of `targetKind`,
 * and awaits its `id`. A missing source value or a missing target facade
 * (forward reference) fails fast and loud.
 */
export function facadeForeignKeyResolver<Row>(
  entityKind: string,
  property: keyof Row & string,
  targetKind: string,
): Resolver<string, ResolverContext<Row, ForeignKeyBackend>> {
  return new Resolver(async ({ facade, source, backend }) => {
    const sourceId = valueAsString(facade.raw(property));
    if (sourceId === undefined) {
      throw new Error(
        `Cannot resolve ${entityKind}.${property} for ${source.namespace}/${source.name}; source ${property} is missing.`,
      );
    }
    const target = backend.findForeignKeyTarget({
      kind: targetKind,
      namespace: source.namespace,
      sourceId,
    });
    if (target === undefined) {
      throw new Error(
        [
          `${entityKind} ${source.namespace}/${source.name} references ${targetKind} ${JSON.stringify(
            sourceId,
          )}, which does not exist in namespace ${source.namespace}.`,
          source.sourceFile && `Source: ${source.sourceFile}.`,
        ]
          .filter(Boolean)
          .join(" "),
      );
    }
    return target.value("id");
  });
}

/**
 * Nullable same-source foreign-key FIND resolver (ADR 0016 #4/#9). Like
 * `facadeForeignKeyResolver`, but an absent/null source reference resolves to
 * `null` (the FK is optional per the source spec) rather than failing; a present
 * reference to a missing target facade still fails fast and loud.
 */
export function facadeNullableForeignKeyResolver<Row>(
  entityKind: string,
  property: keyof Row & string,
  targetKind: string,
): Resolver<string | null, ResolverContext<Row, ForeignKeyBackend>> {
  return new Resolver(async ({ facade, source, backend }) => {
    const sourceId = valueAsString(facade.raw(property));
    if (sourceId === undefined) {
      return null;
    }
    const target = backend.findForeignKeyTarget({
      kind: targetKind,
      namespace: source.namespace,
      sourceId,
    });
    if (target === undefined) {
      throw new Error(
        [
          `${entityKind} ${source.namespace}/${source.name} references ${targetKind} ${JSON.stringify(
            sourceId,
          )}, which does not exist in namespace ${source.namespace}.`,
          source.sourceFile && `Source: ${source.sourceFile}.`,
        ]
          .filter(Boolean)
          .join(" "),
      );
    }
    return target.value("id");
  });
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

/** Title-case an organization/address string property (NULLABLE column). */
export function titleCaseResolverNullable<Row, Backend>(
  property: keyof Row & string,
): Resolver<string | null, ResolverContext<Row, Backend>> {
  return new Resolver<string | null, ResolverContext<Row, Backend>>(
    casingResolveFn<Row, Backend>(property, titleCase),
    { defaultValue: null },
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
