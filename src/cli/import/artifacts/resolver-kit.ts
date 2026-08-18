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
