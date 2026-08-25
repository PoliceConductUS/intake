import {
  Resolver,
  valueAsString,
  type PropertyResolutionFacade,
  type ResolverContext,
  type FacadeSource,
  type CanonicalIdBackend,
  type ForeignKeyBackend,
} from "../resolver-kit.js";

/**
 * The backend a resolver-based entity facade reaches through: its own
 * canonical-id find-or-create, the existing DB row (for create-vs-update), and
 * the same-source foreign-key find. It composes the two minimal kit backends.
 */
export type EntityFacadeBackend = CanonicalIdBackend &
  ForeignKeyBackend & {
    existingRow(id: string): Promise<Record<string, unknown> | undefined>;
    getLocationPathByPath(
      path: string,
    ): Promise<{ location_path_id: string } | undefined>;
  };

/** Per-property resolvers for a facade's row (ADR 0016). */
export type EntityResolvers<Row> = Partial<{
  [K in keyof Row]: Resolver<Row[K], ResolverContext<Row, EntityFacadeBackend>>;
}>;

/** The create/update mutation envelope constructors a facade emits toward. */
export type MutationConstructors<Env> = {
  create: { new: (input: { metadata: EnvelopeMetadata; spec: never }) => Env };
  update: {
    new: (input: {
      metadata: EnvelopeMetadata;
      spec: { operations: MutationOperation[] };
    }) => Env;
  };
};

type EnvelopeMetadata = { namespace: string; name: string };

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

/**
 * A resolver-based facade for a straightforward entity: `id` is a canonical-id
 * find-or-create, foreign keys are FK resolvers, and every other column passes
 * through from the source spec. It owns the memoized property accessor and the
 * create-vs-update mutation planning (the same check/set shape the License
 * family uses). Entities needing bespoke resolution (Agency geocoding, Personnel
 * slugs) keep their own hand-written facades; the simple ones share this.
 */
export class EntityFacade<
  Row extends { id: string },
  Env,
> implements PropertyResolutionFacade<Row> {
  private readonly spec: Record<string, unknown> = {};
  private readonly memo = new Map<keyof Row, Promise<unknown>>();
  private readonly inProgress = new Set<keyof Row>();
  private readonly current?: Record<string, unknown>;
  private readonly source: FacadeSource;
  private readonly backend: EntityFacadeBackend;

  constructor(
    private readonly kind: string,
    /** The non-id columns to resolve and write, in a stable order. */
    private readonly columns: readonly (keyof Row & string)[],
    private readonly resolvers: EntityResolvers<Row>,
    private readonly mutations: MutationConstructors<Env>,
    options: {
      current?: Record<string, unknown>;
      source: FacadeSource;
      backend: EntityFacadeBackend;
    },
  ) {
    this.current = options.current;
    this.source = options.source;
    this.backend = options.backend;
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
      return await resolver.resolve(
        { facade: this, source: this.source, backend: this.backend },
        () => this.unresolvedMessage(property),
      );
    } finally {
      this.inProgress.delete(property);
    }
  }

  private plainValue<K extends keyof Row>(property: K): Row[K] {
    const value = this.spec[property as string];
    return (value === undefined ? null : value) as Row[K];
  }

  private unresolvedMessage(property: keyof Row): string {
    return `Cannot resolve ${this.kind}.${String(
      property,
    )} for source ${this.source.namespace}/${this.source.name}; offending value ${JSON.stringify(
      this.spec[property as string],
    )}.`;
  }

  async toMutation(): Promise<Env> {
    const id = await this.value("id" as keyof Row & string);
    const resolved: Record<string, unknown> = {};
    for (const column of this.columns) {
      resolved[column] = await this.value(column);
    }

    const current =
      this.current ??
      (await this.backend.existingRow(id as unknown as string));

    if (current === undefined) {
      return this.mutations.create.new({
        metadata: {
          namespace: this.source.namespace,
          name: this.source.name,
        },
        spec: { id, ...resolved } as never,
      });
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
        if (Object.is(from, to)) {
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
      metadata: {
        namespace: this.source.namespace,
        name: this.source.name,
      },
      spec: { operations },
    });
  }
}
