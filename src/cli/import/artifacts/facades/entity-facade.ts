import {
  Resolver,
  valueAsString,
  type PropertyResolutionFacade,
  type ResolverContext,
  type FacadeSource,
  type PropertyCache,
  type CanonicalIdBackend,
  type ForeignKeyBackend,
  type BusinessKeyIdBackend,
  type SelectorBackend,
} from "../resolver-kit.js";
import { typedInputFingerprint } from "../../../state/resolved-property/index.js";
import { valuesEqual } from "../../../../shared/values-equal.js";

/**
 * The backend a resolver-based entity facade reaches through: its own
 * canonical-id find-or-create, the existing DB row (for create-vs-update), and
 * the same-source foreign-key find. It composes the two minimal kit backends.
 * Kinds that resolve slugs or geocode (Personnel, Agency) inject a wider backend
 * that also carries those capabilities; the extra methods are only ever called
 * by the resolvers configured for those kinds.
 */
export type EntityFacadeBackend = CanonicalIdBackend &
  ForeignKeyBackend &
  BusinessKeyIdBackend &
  SelectorBackend & {
    existingRow(id: string): Promise<Record<string, unknown> | undefined>;
    getLocationPathByPath(
      path: string,
    ): Promise<{ location_path_id: string } | undefined>;
  };

/** Per-property resolvers for a facade's row (ADR 0016). */
export type EntityResolvers<Row, Backend = EntityFacadeBackend> = Partial<{
  [K in keyof Row]: Resolver<Row[K], ResolverContext<Row, Backend>>;
}>;

type EnvelopeMetadata = { namespace: string; name: string };

/** The create/update/read mutation envelope constructors a facade emits toward. */
export type MutationConstructors<Env> = {
  create: { new: (input: { metadata: EnvelopeMetadata; spec: never }) => Env };
  update?: {
    new: (input: {
      metadata: EnvelopeMetadata;
      spec: { operations: MutationOperation[] };
    }) => Env;
  };
  read?: { new: (input: { metadata: EnvelopeMetadata; spec: never }) => Env };
};

type MutationOperation =
  | {
      action: "check";
      path: string;
      value: unknown;
      reason: string;
      source: MutationSource;
    }
  | {
      action: "set";
      path: string;
      from: unknown;
      to: unknown;
      reason: string;
      source: MutationSource;
    };

type MutationSource = {
  namespace: string;
  command: { name: string };
  kind: string;
  name: string;
};

/** How an existing row's mutation is expressed: a diffed Update, or a Read. */
type UpsertMode = "update" | "read";

/** Optional shape/identity knobs; every default reproduces a plain `id` entity. */
export type EntityFacadeOptions<Backend> = {
  current?: Record<string, unknown>;
  source: FacadeSource;
  backend: Backend;
  /** The identity column; `id` for canonical entities, else e.g. `location_path_id`. */
  identity?: string;
  /** Existing row → a diffed Update (default) or a Read (natural-key idempotent rows). */
  upsert?: UpsertMode;
  /** The `source > cache > live-resolve` property cache (ADR 0019). */
  cache?: PropertyCache;
  /** Properties resolved through the cache (`RESOLVED_PROPERTIES[kind]`; identity excluded). */
  cacheableProperties?: readonly string[];
};

/**
 * The single resolver-based facade engine (ADR 0016/0019): per-property
 * memoization, circular-dependency detection, plain source-or-null pass-through
 * for columns no resolver manages, the `source > cache > live-resolve` property
 * cache, and create-vs-(update|read) mutation planning. Everything entity-specific
 * — the resolver map, identity column, upsert mode, cacheable properties — is
 * configuration; there is no per-entity subclass.
 */
export class EntityFacade<
  Row,
  Env,
  Backend extends EntityFacadeBackend = EntityFacadeBackend,
> implements PropertyResolutionFacade<Row> {
  private readonly spec: Record<string, unknown> = {};
  private readonly memo = new Map<keyof Row, Promise<unknown>>();
  private readonly inProgress = new Set<keyof Row>();
  private readonly current?: Record<string, unknown>;
  private readonly source: FacadeSource;
  private readonly backend: Backend;
  private readonly identity: keyof Row & string;
  private readonly upsert: UpsertMode;
  private readonly cache?: PropertyCache;
  private readonly cacheableProperties: ReadonlySet<string>;

  constructor(
    private readonly kind: string,
    /** The non-identity columns to resolve and write, in a stable order. */
    private readonly columns: readonly (keyof Row & string)[],
    private readonly resolvers: EntityResolvers<Row, Backend>,
    private readonly mutations: MutationConstructors<Env>,
    options: EntityFacadeOptions<Backend>,
  ) {
    this.current = options.current;
    this.source = options.source;
    this.backend = options.backend;
    this.identity = (options.identity ?? "id") as keyof Row & string;
    this.upsert = options.upsert ?? "update";
    this.cache = options.cache;
    this.cacheableProperties = new Set(
      (options.cacheableProperties ?? []).filter(
        (property) => property !== this.identity,
      ),
    );
  }

  merge(spec: Record<string, unknown>): void {
    Object.assign(this.spec, spec);
  }

  raw(property: keyof Row): unknown {
    return this.spec[property as string];
  }

  value<K extends keyof Row>(property: K): Promise<Row[K]> {
    const cached = this.memo.get(property);
    if (cached !== undefined) {
      return cached as Promise<Row[K]>;
    }
    const pending = this.computeValue(property);
    this.memo.set(property, pending);
    return pending;
  }

  private async computeValue<K extends keyof Row>(
    property: K,
  ): Promise<Row[K]> {
    if (this.inProgress.has(property)) {
      throw new Error(
        `Circular property dependency while resolving ${this.kind}.${String(
          property,
        )} for ${this.source.namespace}/${this.source.name}.`,
      );
    }
    this.inProgress.add(property);
    try {
      const resolver = this.resolvers[property];
      if (resolver === undefined) {
        return this.plainValue(property);
      }
      const context: ResolverContext<Row, Backend> = {
        facade: this,
        source: this.source,
        backend: this.backend,
      };
      const locate = () => this.unresolvedMessage(property);
      if (
        this.cache === undefined ||
        !this.cacheableProperties.has(String(property))
      ) {
        return await resolver.resolve(context, locate);
      }
      return await this.resolveThroughCache(
        property,
        resolver,
        context,
        locate,
        this.cache,
      );
    } finally {
      this.inProgress.delete(property);
    }
  }

  /**
   * source > cache > live-resolve. A source-provided value wins and is returned
   * untouched — never cached, because the source is authoritative and re-read
   * each run. With no source value, a cache hit short-circuits the resolver; a
   * miss resolves live and writes the result back.
   */
  private async resolveThroughCache<K extends keyof Row>(
    property: K,
    resolver: Resolver<Row[K], ResolverContext<Row, Backend>>,
    context: ResolverContext<Row, Backend>,
    locate: () => string,
    cache: PropertyCache,
  ): Promise<Row[K]> {
    if (this.hasSourceValue(property)) {
      return resolver.resolve(context, locate);
    }
    // The resolver alone knows what its value depends on; ask it for that
    // normalized input and key the cache by its fingerprint (ADR 0019), so an
    // unchanged input serves the cached value and a changed one re-resolves.
    const input = await resolver.cacheInput(context);
    const key = {
      kind: this.kind,
      id: String(await this.value(this.identity)),
      property: String(property),
      inputFingerprint:
        input === undefined ? undefined : typedInputFingerprint(input),
    };
    const hit = await cache.read(key);
    if (hit !== undefined) {
      return hit as Row[K];
    }
    const resolved = await resolver.resolve(context, locate);
    if (resolved !== null && resolved !== undefined) {
      await cache.write(
        {
          ...key,
          source: {
            namespace: this.source.namespace,
            name: this.source.name,
          },
        },
        resolved,
      );
    }
    return resolved;
  }

  // True when the metadata declares PATCH (ADR 0034): resolve an existing row and
  // write only the provided fields — a partial update, so the untouched foreign
  // keys are never resolved. PUT (upsert) and POST (create) resolve every column.
  private identityIsPartialUpdate(): boolean {
    return this.source.action === "PATCH";
  }

  private hasSourceValue(property: keyof Row): boolean {
    const raw = this.spec[property as string];
    if (raw === undefined || raw === null) {
      return false;
    }
    return typeof raw === "string" ? raw.trim() !== "" : true;
  }

  private plainValue<K extends keyof Row>(property: K): Row[K] {
    // A field the source did not provide stays `undefined` (omitted downstream);
    // an explicit `null` is preserved (written as null). Absence is not the same
    // as an intentional null — a source that never mentions a column must not
    // overwrite it (e.g. a roster re-import omitting badge_number).
    return this.spec[property as string] as Row[K];
  }

  private unresolvedMessage(property: keyof Row): string {
    return `Cannot resolve ${this.kind}.${String(
      property,
    )} for source ${this.source.namespace}/${this.source.name}; offending value ${JSON.stringify(
      this.spec[property as string],
    )}.`;
  }

  // The row this facade would write (identity + non-identity columns). The
  // convergence overlay records it so a later same-identity facade reads it.
  async resolvedRow(): Promise<{
    identityValue: string;
    resolved: Record<string, unknown>;
  }> {
    const identityValue = String(await this.value(this.identity));
    // A selector-resolved identity (ADR 0034) targets an existing row and writes
    // only the fields the source provides, so it must not resolve — and fail on —
    // the foreign keys it is not changing (a partial update). A scalar identity
    // resolves every column as before (a full create/update).
    const partial = this.identityIsPartialUpdate();
    const resolved: Record<string, unknown> = {};
    for (const column of this.columns) {
      if (partial && !this.hasSourceValue(column)) {
        continue;
      }
      const value = await this.value(column);
      // Absent (undefined) → omit: not this source's field to write, so it never
      // overwrites what another source set. An explicit null is kept and written
      // as null — a source must be able to clear a field.
      if (value === undefined) {
        continue;
      }
      resolved[column] = value;
    }
    return { identityValue, resolved };
  }

  async toMutation(): Promise<Env> {
    const { identityValue, resolved } = await this.resolvedRow();

    const current =
      this.current ?? (await this.backend.existingRow(identityValue));

    // The envelope name is the target row's key value (ADR 0027): the pair
    // (kind, name) is (which table/op, which row), and replay locates an
    // update/read row by keyColumnName = name.
    const metadata: EnvelopeMetadata = {
      namespace: this.source.namespace,
      name: String(identityValue),
    };

    if (current === undefined) {
      return this.mutations.create.new({
        metadata,
        spec: { [this.identity]: identityValue, ...resolved } as never,
      });
    }

    if (this.upsert === "read") {
      if (this.mutations.read === undefined) {
        throw new Error(
          `Cannot emit a ${this.kind} read for ${this.source.namespace}/${this.source.name}: no read mutation configured.`,
        );
      }
      return this.mutations.read.new({ metadata, spec: {} as never });
    }

    if (this.mutations.update === undefined) {
      throw new Error(
        `Cannot emit a ${this.kind} update for ${this.source.namespace}/${this.source.name}: no update mutation configured.`,
      );
    }
    const commandName = valueAsString(this.source.commandName);
    if (commandName === undefined) {
      throw new Error(
        `Cannot create ${this.kind} update for ${this.source.namespace}/${this.source.name} without command name.`,
      );
    }
    const source: MutationSource = {
      namespace: this.source.namespace,
      command: { name: commandName },
      kind: this.kind,
      name: this.source.name,
    };
    const operations: MutationOperation[] = Object.entries(resolved).map(
      ([path, to]) => {
        const from = current[path];
        if (valuesEqual(from, to)) {
          return {
            action: "check",
            path,
            value: to,
            reason: `Expected existing ${this.kind} ${path}.`,
            source,
          };
        }
        return {
          action: "set",
          path,
          from,
          to,
          reason: `Set ${this.kind} ${path}.`,
          source,
        };
      },
    );

    return this.mutations.update.new({
      metadata,
      spec: { operations },
    });
  }
}
