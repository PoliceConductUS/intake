import { createId } from "@paralleldrive/cuid2";
import {
  valueAsString,
  type PropertyCache,
  type ForeignKeyIdSource,
} from "./resolver-kit.js";
import type {
  EntityFacade,
  EntityFacadeBackend,
} from "./facades/entity-facade.js";
import {
  buildFacadeForKind,
  identityColumnForKind,
} from "./facades/resolver-registry.js";
import { RECORD_KINDS_IN_DEPENDENCY_ORDER } from "../../../shared/io/generated/entity-specs.js";
import { INTAKE_API_VERSION } from "../../../shared/io/import-types.js";
import type { DatabaseClient } from "../../database/index.js";
import { SlugAllocator } from "./slug.js";
import { CurrentRowReader } from "./current-row-reader.js";
import { planDatabaseMutationItems } from "./mutation-plan.js";
import {
  LocationDataContext,
  LocationPathDataContext,
} from "./location-resolution.js";
import type {
  AddressResolutionRequest,
  AddressResolution,
  LocationResolution,
  ResolveAddressInput,
} from "./location-resolution.js";
import type { ResolvedPropertyCacheInput } from "../../state/resolved-property/index.js";

/**
 * The workspace `ResolvedProperty` store, adapted to `(input) -> value`. The
 * agency facade's `PropertyCache` reads and writes resolved properties (and
 * seeds) through it (ADR 0019).
 */
type ResolvedPropertyStore = {
  read(input: ResolvedPropertyCacheInput): Promise<unknown | undefined>;
  write(input: ResolvedPropertyCacheInput & { value: unknown }): Promise<void>;
};
import {
  DatabaseMutations,
  type DatabaseMutationItem,
  type DatabaseMutationsEnvelope,
} from "./io/DatabaseMutations.js";
import type { DatabaseMutationEnvelope } from "./io/DatabaseMutation.js";
import type {
  LedgerEntityKind,
  SourceNameToCanonicalIdLedger,
} from "../../state/source-name-to-canonical-id/index.js";

type DataContextLogger = {
  debug?(object: Record<string, unknown>, message: string): void;
};

export type DataContextOptions = {
  client?: DatabaseClient;
  logger?: DataContextLogger;
  resolveAddress?: (
    input: AddressResolutionRequest,
  ) => Promise<AddressResolution | undefined>;
  resolvedPropertyStore?: ResolvedPropertyStore;
  commandName?: string;
  /**
   * Durable Identity Map accessor over the SourceNameToCanonicalId ledger.
   * Injected so each canonical-id resolver finds-or-creates its own entity's id
   * with a single per-record file read/write (ADR 0016 #4, ADR 0017) — no bulk
   * ledger load, no whole-map re-persist.
   */
  ledger?: SourceNameToCanonicalIdLedger;
};

type SourceRecordContext = {
  apiVersion: typeof INTAKE_API_VERSION;
  namespace: string;
  name: string;
  canonicalId?: string;
  commandName?: string;
  current?: Record<string, unknown>;
  spec?: Record<string, unknown>;
  /** Absolute path of the file this record was read from (for error context). */
  sourceFile?: string;
};

export type DatabaseMutationsMetadataInput = {
  namespace: string;
  name: string;
  sourceArtifactsName?: string;
  sourceArtifactsPath?: string;
  sourceArtifactsDigest?: string;
  artifactMutation?: { path: string; digest: string };
  databaseSchema?: Record<string, unknown>;
};

function validateSourceRecordContext(input: SourceRecordContext): void {
  if (input.apiVersion !== INTAKE_API_VERSION) {
    throw new Error(
      `Unsupported source apiVersion: ${String(input.apiVersion)}`,
    );
  }
  if (valueAsString(input.namespace) === undefined) {
    throw new Error("Source record metadata.namespace is required.");
  }
  if (valueAsString(input.name) === undefined) {
    throw new Error("Source record metadata.name is required.");
  }
}




/** A facade the generic registry builder produces (its row shape is erased). */
type RegistryFacade = EntityFacade<
  Record<string, unknown>,
  DatabaseMutationEnvelope
>;

// The single backend the resolver builder injects: the generic facade backend
// plus the slug and agency-geocode capabilities the Personnel/Agency resolvers
// reach through. Inert for kinds whose resolvers never call them.
type UnifiedFacadeBackend = EntityFacadeBackend & {
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
  resolveAgencyLocation(input: ResolveAddressInput): Promise<LocationResolution>;
};

export class DataContext {
  readonly locations: LocationDataContext;
  readonly locationPaths: LocationPathDataContext;
  private readonly client?: DatabaseClient;
  private readonly rows: CurrentRowReader;
  readonly logger?: DataContextLogger;
  private readonly addressResolutionCache = new Map<
    string,
    LocationResolution
  >();
  private readonly resolveAddressFn?: DataContextOptions["resolveAddress"];
  private readonly resolvedPropertyStore?: ResolvedPropertyStore;
  private readonly commandName?: string;
  private readonly ledger?: SourceNameToCanonicalIdLedger;
  private readonly slugs: SlugAllocator;
  /** Every facade built this command, grouped by kind then memo key. */
  private readonly facadesByKind = new Map<
    string,
    Map<string, RegistryFacade>
  >();

  constructor(options: DataContextOptions) {
    this.client = options.client;
    this.rows = new CurrentRowReader(options.client);
    this.logger = options.logger;
    this.resolveAddressFn = options.resolveAddress;
    this.resolvedPropertyStore = options.resolvedPropertyStore;
    this.commandName = options.commandName;
    this.ledger = options.ledger;
    this.slugs = new SlugAllocator(async (kind, slug) => {
      const row = await this.rows.getById(kind, slug, "slug");
      return row === undefined ? undefined : valueAsString(row.id);
    });
    this.locations = new LocationDataContext(this);
    this.locationPaths = new LocationPathDataContext(this);
  }

  /**
   * Adapts the workspace `ResolvedProperty` store to the facade `PropertyCache`,
   * keyed by `(kind, canonical id, property)`. The generic resolver cache and the
   * committed seeds share this store, so a resolved property (or a seed) is a
   * cache hit — no source- or property-specific code (ADR 0019).
   */
  private propertyCache(): PropertyCache | undefined {
    const cache = this.resolvedPropertyStore;
    if (cache === undefined) {
      return undefined;
    }
    return {
      read: ({ kind, id, property }) =>
        cache.read({
          subject: { apiVersion: INTAKE_API_VERSION, kind, name: id },
          targetProperty: property,
        }),
      write: ({ kind, id, property }, value) =>
        cache.write({
          subject: { apiVersion: INTAKE_API_VERSION, kind, name: id },
          targetProperty: property,
          value,
        }),
    };
  }

  // The full backend every registry-built facade reaches through (ADR 0016/0019):
  // canonical-id find-or-create, lazy current-row read by identityColumn, same-
  // source FK finds, location-path resolve-by-path, and the slug + agency-geocode
  // capabilities the Personnel/Agency resolvers use. A kind uses only the
  // capabilities its resolvers need; the others are inert.
  private resolverBackend(
    kind: string,
    identityColumn?: string,
  ): UnifiedFacadeBackend {
    return {
      findOrCreateCanonicalId: (input) => this.findOrCreateCanonicalId(input),
      existingRow: (id) => this.rows.getById(kind, id, identityColumn),
      findForeignKeyTarget: (input) => this.findForeignKeyTarget(input),
      getLocationPathByPath: (path) => this.locationPaths.getByPath(path),
      ensureUniqueSlug: (input) =>
        this.slugs.ensureUnique(input.kind, {
          base: input.base,
          canonicalId: input.canonicalId,
        }),
      registerSlug: (input) =>
        this.slugs.register(input.kind, input.slug, input.canonicalId),
      resolveAgencyLocation: (input) => this.locations.resolveAddress(input),
    };
  }

  // The one construction path every registry-owned kind shares (ADR 0016/0019):
  // memoize by (apiVersion, namespace, kind, name), merging the source spec into
  // an existing facade or building a new one from the registry. The per-kind
  // resolution nuance lives entirely in the registry, not here.
  private facadesFor(kind: string): Map<string, RegistryFacade> {
    let facades = this.facadesByKind.get(kind);
    if (facades === undefined) {
      facades = new Map();
      this.facadesByKind.set(kind, facades);
    }
    return facades;
  }

  facadeFromSource(kind: string, input: SourceRecordContext): RegistryFacade {
    validateSourceRecordContext(input);
    const facades = this.facadesFor(kind);
    const key = [input.apiVersion, input.namespace, kind, input.name].join(":");
    const existing = facades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) {
        existing.merge(input.spec);
      }
      return existing;
    }
    const facade = buildFacadeForKind(kind, {
      current: input.current,
      source: {
        namespace: input.namespace,
        sourceFile: input.sourceFile,
        name: input.name,
        commandName: input.commandName ?? this.commandName,
      },
      backend: this.resolverBackend(kind, identityColumnForKind(kind)),
      // The property cache is gated by RESOLVED_PROPERTIES[kind]: a kind with no
      // cache-backed properties never touches it (ADR 0019).
      cache: this.propertyCache(),
    }) as RegistryFacade;
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    facades.set(key, facade);
    return facade;
  }

  // Find a seeded/existing id before minting, so ids stay stable (ADR 0016 #4).
  private async findOrCreateCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string> {
    if (this.ledger === undefined) {
      return createId();
    }
    return this.ledger.findOrCreate(
      input.namespace,
      input.kind as LedgerEntityKind,
      input.sourceId,
    );
  }

  /**
   * Same-source foreign-key FIND (ADR 0016 #4/#9): return an already-emitted
   * target facade as an id-resolvable reference, or undefined when none exists.
   * It never creates the target — a missing target is the referrer's
   * forward-reference violation, raised loudly by the FK resolver.
   */
  private findForeignKeyTarget(input: {
    kind: string;
    namespace: string;
    sourceId: string;
  }): ForeignKeyIdSource | undefined {
    const key = [
      INTAKE_API_VERSION,
      input.namespace,
      input.kind,
      input.sourceId,
    ].join(":");
    const facade = this.facadesByKind.get(input.kind)?.get(key);
    if (facade === undefined) {
      return undefined;
    }
    // Registry facades resolve toward an erased row, so bridge `value("id")` to
    // the target's identity column (LocationPath keys on `location_path_id`).
    const identityColumn = identityColumnForKind(input.kind);
    return { value: () => facade.value(identityColumn) as Promise<string> };
  }

  async toMutations(): Promise<DatabaseMutationEnvelope[]> {
    // Every facade is registered during the add phase, so a FK find always locates
    // its target regardless of resolution order; the emitted plan is re-sorted by
    // the FK-derived topological sort in toDatabaseMutationItems. Draining in the
    // generated dependency order keeps the pre-sort output stable and legible.
    const mutations: DatabaseMutationEnvelope[] = [];
    for (const kind of RECORD_KINDS_IN_DEPENDENCY_ORDER) {
      const facades = this.facadesByKind.get(kind);
      if (facades === undefined) {
        continue;
      }
      const kindMutations = await Promise.all(
        [...facades.values()].map((facade) => facade.toMutation()),
      );
      // A single kind can hold >100k rows (tcole assignments); spreading that
      // into push() arguments overflows the call stack, so append in place.
      for (const mutation of kindMutations) {
        mutations.push(mutation);
      }
    }
    return mutations;
  }

  async toDatabaseMutationItems(): Promise<DatabaseMutationItem[]> {
    return planDatabaseMutationItems(await this.toMutations());
  }

  async toDatabaseMutations(
    metadata: DatabaseMutationsMetadataInput,
  ): Promise<DatabaseMutationsEnvelope> {
    return DatabaseMutations.new({
      metadata,
      spec: {
        mutations: await this.toDatabaseMutationItems(),
      },
    });
  }

  async resolveAddress(
    input: AddressResolutionRequest,
  ): Promise<AddressResolution | undefined> {
    return this.resolveAddressFn?.(input);
  }

  getCachedLocation(
    entityType: string,
    entityId: string,
  ): LocationResolution | undefined {
    return this.addressResolutionCache.get(`${entityType}:${entityId}`);
  }

  cacheLocation(
    entityType: string,
    entityId: string,
    resolution: LocationResolution,
  ): void {
    this.addressResolutionCache.set(`${entityType}:${entityId}`, resolution);
  }

  databaseClient(): DatabaseClient {
    if (this.client === undefined) {
      throw new Error("Database client is required for database reads.");
    }
    return this.client;
  }

}



