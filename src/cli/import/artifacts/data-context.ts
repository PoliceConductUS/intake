import { createId } from "@paralleldrive/cuid2";
import { LocationPathSpec } from "../../../shared/io/generated/entity-specs.js";
import type { ArtifactsEnvelope } from "../../../shared/io/Artifacts.js";
import {
  INTAKE_API_VERSION,
  sourceNameForImportRecord,
} from "../../../shared/io/import-types.js";
import type { DatabaseClient } from "../../database/index.js";
import {
  readLocationPathAliasByPath,
  readLocationPathById,
  readLocationPathByPath,
  readLocationPathsContainingPoint,
} from "../../database/location-paths.js";
import type { ImportOperation, ImportOperations } from "./operations.js";
import {
  type AgencyOfficerRow,
  type AgencyRow,
  type ImportRows,
  type LocationPathAliasRow,
  type LocationPathRow,
  type ResolvedProperties,
} from "./transform.js";
import { readDatabaseRecordsBySlugs } from "../../database/entities.js";

/** Tables whose slug uniqueness the DataContext enforces (generate-unique). */
type SlugTableName = "public.officers" | "public.agency";
import {
  AgencyFieldResolutionError,
  type AgencyFieldResolutionOptions,
  type AgencyResolvedPropertyUpdate,
  missingResolvableAgencyFields,
  resolveAgencyMissingFields,
  resolveCachedAgencyLocationPath,
} from "./agency-field-resolution.js";
import {
  AgencyCreate,
  type AgencyCreateEnvelope,
} from "./io/generated-mutations/AgencyCreate.js";
import {
  AgencyUpdate,
  type AgencyUpdateEnvelope,
} from "./io/generated-mutations/AgencyUpdate.js";
import {
  AgencyPersonnelCreate,
  type AgencyPersonnelCreateEnvelope,
} from "./io/generated-mutations/AgencyPersonnelCreate.js";
import {
  AgencyPersonnelUpdate,
  type AgencyPersonnelUpdateEnvelope,
} from "./io/generated-mutations/AgencyPersonnelUpdate.js";
import {
  PersonnelCreate,
  type PersonnelCreateEnvelope,
} from "./io/generated-mutations/PersonnelCreate.js";
import {
  PersonnelUpdate,
  type PersonnelUpdateEnvelope,
} from "./io/generated-mutations/PersonnelUpdate.js";
import {
  LicensingAuthorityCreate,
  type LicensingAuthorityCreateEnvelope,
} from "./io/generated-mutations/LicensingAuthorityCreate.js";
import {
  LicensingAuthorityUpdate,
  type LicensingAuthorityUpdateEnvelope,
} from "./io/generated-mutations/LicensingAuthorityUpdate.js";
import {
  LicenseCreate,
  type LicenseCreateEnvelope,
} from "./io/generated-mutations/LicenseCreate.js";
import {
  LicenseUpdate,
  type LicenseUpdateEnvelope,
} from "./io/generated-mutations/LicenseUpdate.js";
import {
  LicenseActionCreate,
  type LicenseActionCreateEnvelope,
} from "./io/generated-mutations/LicenseActionCreate.js";
import {
  LicenseActionUpdate,
  type LicenseActionUpdateEnvelope,
} from "./io/generated-mutations/LicenseActionUpdate.js";
import {
  DatabaseMutations,
  type DatabaseMutationItem,
  type DatabaseMutationsEnvelope,
} from "./io/DatabaseMutations.js";
import type { SourceNameToCanonicalIds } from "../../state/source-name-to-canonical-id/index.js";

type DataContextLogger = {
  debug?(object: Record<string, unknown>, message: string): void;
};

export type ImportEntityType = "agency" | "agencyOfficer";

export type ImportEntityRow = {
  agency: AgencyRow;
  agencyOfficer: AgencyOfficerRow;
};

export type ImportEntityResolver<
  EntityType extends ImportEntityType = ImportEntityType,
> = (row: ImportEntityRow[EntityType], context: DataContext) => Promise<void>;

export type DataContextOptions = {
  client?: DatabaseClient;
  rows: ImportRows;
  logger?: DataContextLogger;
  databaseLocationPaths?: LocationPathRow[];
  databaseLocationPathAliases?: LocationPathAliasRow[];
  operations?: ImportOperations;
  entityResolvers?: Partial<{
    [EntityType in ImportEntityType]: ImportEntityResolver<EntityType>;
  }>;
  loadLocationPathById?: (
    locationPathId: string,
  ) => Promise<LocationPathRow | undefined>;
  loadLocationPathByPath?: (
    locationPathPath: string,
  ) => Promise<LocationPathRow | undefined>;
  resolveAddress?: (
    input: AddressResolutionRequest,
  ) => Promise<AddressResolution | undefined>;
  resolveAdministrativeArea?: (
    input: LocationAdministrativeAreaRequest,
  ) => Promise<LocationAdministrativeAreaResolution | undefined>;
  agencyFieldResolutionOptions?: AgencyFieldResolutionOptions;
  resolvedProperties?: ResolvedProperties;
  commandName?: string;
  sourceNameToCanonicalIds?: SourceNameToCanonicalIds;
  databaseAgencies?: Record<string, unknown>[];
  databaseOfficers?: Record<string, unknown>[];
  databaseLicensingAuthorities?: Record<string, unknown>[];
  databaseLicenses?: Record<string, unknown>[];
  databaseLicenseActions?: Record<string, unknown>[];
  /**
   * Durable writer for the SourceNameToCanonicalId ledger. Injected so the
   * canonical-id resolvers can mint AND persist an entity's own id themselves
   * (ADR 0016 #4), without depending on any earlier minting stage.
   */
  persistSourceNameToCanonicalIds?: (
    namespace: string,
    mappings: SourceNameToCanonicalIds,
  ) => Promise<void>;
};

type SourceRecordContext = {
  apiVersion: typeof INTAKE_API_VERSION;
  namespace: string;
  name: string;
  canonicalId?: string;
  commandName?: string;
  current?: Record<string, unknown>;
  spec?: Record<string, unknown>;
};

type FacadeSource = {
  namespace: string;
  name: string;
  canonicalId?: string;
  commandName?: string;
};

type FacadeEntry<TFacade> = {
  source: FacadeSource;
  facade: TFacade;
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

type OwnedColumnsMetadata = {
  agency?: ImportRows["ownedColumns"]["agencies"][string];
  agencyPersonnel?: ImportRows["ownedColumns"]["agencyOfficers"][string];
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

// AgencyFacade and PersonnelFacade are defined below alongside the other
// resolver-based facades (License / LicenseAction), after the resolver
// infrastructure.

export class AgencyPersonnelFacade {
  private static readonly kind = "AgencyPersonnel";
  private readonly current?: Record<string, unknown>;
  private readonly spec: Record<string, unknown>;

  constructor(current?: Record<string, unknown>) {
    this.current = current;
    this.spec = {};
  }

  merge(spec: Record<string, unknown>): void {
    Object.assign(this.spec, spec);
  }

  toMutation(
    sourceContext: FacadeSource,
  ): AgencyPersonnelCreateEnvelope | AgencyPersonnelUpdateEnvelope {
    const canonicalId = valueAsString(sourceContext.canonicalId);
    if (canonicalId === undefined) {
      throw new Error(
        `Cannot create agency-personnel mutation for ${sourceContext.namespace}/${sourceContext.name} without canonical ID.`,
      );
    }

    if (this.current === undefined) {
      return AgencyPersonnelCreate.new({
        metadata: {
          namespace: sourceContext.namespace,
          name: sourceContext.name,
        },
        spec: {
          id: canonicalId,
          ...this.spec,
        } as Parameters<typeof AgencyPersonnelCreate.new>[0]["spec"],
      });
    }

    const commandName = valueAsString(sourceContext.commandName);
    if (commandName === undefined) {
      throw new Error(
        `Cannot create agency-personnel update for ${sourceContext.namespace}/${sourceContext.name} without command name.`,
      );
    }

    const source = {
      namespace: sourceContext.namespace,
      command: { name: commandName },
      kind: AgencyPersonnelFacade.kind,
      name: sourceContext.name,
    };
    const operations = Object.entries(this.spec)
      .filter(([path]) => path !== "id")
      .map(([path, to]) => {
        const from = this.current?.[path];
        if (Object.is(from, to)) {
          return {
            action: "check" as const,
            path,
            value: to,
            reason: `Expected existing ${AgencyPersonnelFacade.kind} ${path}.`,
            source,
          };
        }

        return {
          action: "set" as const,
          path,
          from,
          to,
          reason: `Set ${AgencyPersonnelFacade.kind} ${path}.`,
          source,
        };
      });

    return AgencyPersonnelUpdate.new({
      metadata: {
        namespace: sourceContext.namespace,
        name: sourceContext.name,
      },
      spec: { operations },
    });
  }
}

// --- ADR 0016: composable per-property resolvers -----------------------------
//
// A property that must be derived before a database write is produced by a
// `Resolver`. A resolver is entity-agnostic: it is handed the source facade (to
// `await` sibling properties) plus the injected backend capabilities it needs,
// and it returns a `Promise<T>` typed to its target column. Only the minimal
// mechanism required to route `LicensingAuthority` through a facade is built
// here (ADR 0016 #8 proves the mechanism first); the durable cache collapse and
// the migration of the other entities are deferred.

/**
 * The database row shape a `LicensingAuthorityFacade` resolves toward. Used to
 * type the generic property accessor so each property's promise carries its own
 * target-column type. (`LicensingAuthority` no longer produces a transform row;
 * the facade owns the column set.)
 */
export type LicensingAuthorityRowShape = {
  id: string;
  name: string;
  abbreviation: string | null;
  website: string | null;
  location_path_id: string;
};

/** Backend capabilities the LicensingAuthority resolvers reach through. */
export type LicensingAuthorityResolverBackend = {
  /**
   * Resolve-or-fail location lookup (ADR 0006/0015): a `location_path` is never
   * minted. Consults current envelope → intake-owned state → database, with
   * alias handling, via the shared `getByPath`.
   */
  getLocationPathByPath(path: string): Promise<LocationPathRow | undefined>;
  /**
   * Find-or-create the entity's own canonical id in the durable
   * `SourceNameToCanonicalId` ledger by `(namespace, kind, source-id)`.
   */
  findOrCreateCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string>;
  /**
   * The existing database row for a resolved canonical id, if any. Lets the
   * facade decide create-vs-update automatically — mirroring how agencies load
   * `current` from `databaseAgencies` — so a re-import emits an update, not a
   * duplicate create.
   */
  getCurrentById(id: string): Record<string, unknown> | undefined;
};

/**
 * The uniform interface a resolver uses to reach the facade it is attached to,
 * the source identity, and the injected backend. The backend type is a
 * parameter so per-entity resolvers (LicensingAuthority, License, LicenseAction)
 * each carry the capabilities they reach through.
 */
export type ResolverContext<
  Row,
  Backend = LicensingAuthorityResolverBackend,
> = {
  facade: PropertyResolutionFacade<Row>;
  source: FacadeSource;
  backend: Backend;
};

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

type LicensingAuthorityResolvers = Partial<{
  [K in keyof LicensingAuthorityRowShape]: Resolver<
    LicensingAuthorityRowShape[K],
    ResolverContext<LicensingAuthorityRowShape>
  >;
}>;

/** Canonical-id find-or-create resolver (ADR 0016 #4, "id" property). */
function licensingAuthorityCanonicalIdResolver(): Resolver<
  string,
  ResolverContext<LicensingAuthorityRowShape>
> {
  return new Resolver(async ({ source, backend }) =>
    // Find in the ledger by (namespace, kind, source-id); mint + persist when
    // absent. Extension point (ADR 0016 #4): a natural-key match against the
    // database recovers an existing row's id before minting — deferred while
    // `licensing_authority` is a new table with no legacy rows.
    backend.findOrCreateCanonicalId({
      namespace: source.namespace,
      kind: "LicensingAuthority",
      sourceId: source.name,
    }),
  );
}

/** `location_path_id` resolve-or-fail resolver (ADR 0006/0015). */
function licensingAuthorityLocationPathResolver(): Resolver<
  string,
  ResolverContext<LicensingAuthorityRowShape>
> {
  return new Resolver(async ({ facade, source, backend }) => {
    // The source supplies a namespace-LOCAL state value (e.g. "tx"); map it to
    // the path `/<state>/` and resolve against the location hierarchy.
    const state = valueAsString(facade.raw("location_path_id"));
    if (state === undefined) {
      throw new Error(
        `Cannot resolve location_path_id for LicensingAuthority ${source.namespace}/${source.name}; source location_path_id is missing.`,
      );
    }
    const path = `/${state.toLowerCase()}/`;
    const locationPath = await backend.getLocationPathByPath(path);
    if (locationPath === undefined) {
      // Resolve-or-fail: a location_path is never minted (ADR 0006).
      throw new Error(
        `Cannot resolve location_path_id for LicensingAuthority ${source.namespace}/${source.name}; source value ${JSON.stringify(
          state,
        )} does not match an imported location_path at ${path}.`,
      );
    }
    return locationPath.location_path_id;
  });
}

export class LicensingAuthorityFacade
  implements PropertyResolutionFacade<LicensingAuthorityRowShape>
{
  private static readonly kind = "LicensingAuthority";
  private readonly current?: Record<string, unknown>;
  private readonly spec: Record<string, unknown> = {};
  private readonly source: FacadeSource;
  private readonly backend: LicensingAuthorityResolverBackend;
  private readonly resolvers: LicensingAuthorityResolvers;
  private readonly memo = new Map<
    keyof LicensingAuthorityRowShape,
    Promise<unknown>
  >();
  private readonly inProgress = new Set<keyof LicensingAuthorityRowShape>();

  constructor(options: {
    current?: Record<string, unknown>;
    source: FacadeSource;
    backend: LicensingAuthorityResolverBackend;
  }) {
    this.current = options.current;
    this.source = options.source;
    this.backend = options.backend;
    this.resolvers = {
      id: licensingAuthorityCanonicalIdResolver(),
      location_path_id: licensingAuthorityLocationPathResolver(),
    };
  }

  merge(spec: Record<string, unknown>): void {
    Object.assign(this.spec, spec);
  }

  raw(property: keyof LicensingAuthorityRowShape): unknown {
    return this.spec[property as string];
  }

  /**
   * Uniform, generic, memoized async accessor. A plain property returns an
   * already-resolved promise of the merged source value; a resolved property
   * runs its attached resolver once per facade instance. A per-facade
   * in-progress guard turns a circular dependency into a loud error.
   */
  value<K extends keyof LicensingAuthorityRowShape>(
    property: K,
  ): Promise<LicensingAuthorityRowShape[K]> {
    const cached = this.memo.get(property);
    if (cached !== undefined) {
      return cached as Promise<LicensingAuthorityRowShape[K]>;
    }
    const pending = this.computeValue(property);
    this.memo.set(property, pending);
    return pending;
  }

  private async computeValue<K extends keyof LicensingAuthorityRowShape>(
    property: K,
  ): Promise<LicensingAuthorityRowShape[K]> {
    if (this.inProgress.has(property)) {
      throw new Error(
        `Circular property dependency while resolving ${LicensingAuthorityFacade.kind}.${String(
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

  private plainValue<K extends keyof LicensingAuthorityRowShape>(
    property: K,
  ): LicensingAuthorityRowShape[K] {
    // Plain source properties resolve to the merged source value already in the
    // target column's datatype; a nullable column with no source value is null.
    const value = this.spec[property as string];
    return (value === undefined ? null : value) as LicensingAuthorityRowShape[K];
  }

  private unresolvedMessage(
    property: keyof LicensingAuthorityRowShape,
  ): string {
    return `Cannot resolve ${LicensingAuthorityFacade.kind}.${String(
      property,
    )} for source ${this.source.namespace}/${this.source.name}; offending value ${JSON.stringify(
      this.spec[property as string],
    )}.`;
  }

  async toMutation(): Promise<
    LicensingAuthorityCreateEnvelope | LicensingAuthorityUpdateEnvelope
  > {
    // Await every column this facade writes — resolution runs here, on demand,
    // and TypeScript enforces that a promise cannot land in a column un-awaited.
    const id = await this.value("id");
    const name = await this.value("name");
    const abbreviation = await this.value("abbreviation");
    const website = await this.value("website");
    const locationPathId = await this.value("location_path_id");

    // Auto-load the existing database row for this canonical id (like agencies),
    // so a re-import emits an update/no-op instead of a duplicate create. This is
    // automatic in the facade path — no per-record special-casing at the caller.
    const current = this.current ?? this.backend.getCurrentById(id);

    if (current === undefined) {
      return LicensingAuthorityCreate.new({
        metadata: {
          namespace: this.source.namespace,
          name: this.source.name,
        },
        spec: {
          id,
          name,
          abbreviation,
          website,
          location_path_id: locationPathId,
        } as Parameters<typeof LicensingAuthorityCreate.new>[0]["spec"],
      });
    }

    const commandName = valueAsString(this.source.commandName);
    if (commandName === undefined) {
      throw new Error(
        `Cannot create licensing authority update for ${this.source.namespace}/${this.source.name} without command name.`,
      );
    }

    const source = {
      namespace: this.source.namespace,
      command: { name: commandName },
      kind: LicensingAuthorityFacade.kind,
      name: this.source.name,
    };
    const desired: Record<string, unknown> = {
      name,
      abbreviation,
      website,
      location_path_id: locationPathId,
    };
    const operations = Object.entries(desired).map(([path, to]) => {
      const from = current[path];
      if (Object.is(from, to)) {
        return {
          action: "check" as const,
          path,
          value: to,
          reason: `Expected existing ${LicensingAuthorityFacade.kind} ${path}.`,
          source,
        };
      }

      return {
        action: "set" as const,
        path,
        from,
        to,
        reason: `Set ${LicensingAuthorityFacade.kind} ${path}.`,
        source,
      };
    });

    return LicensingAuthorityUpdate.new({
      metadata: {
        namespace: this.source.namespace,
        name: this.source.name,
      },
      spec: { operations },
    });
  }
}

// --- License / LicenseAction facades (ADR 0016) ------------------------------
//
// License and LicenseAction mirror LicensingAuthority: each property is produced
// by a resolver. The `id` is a canonical-id find-or-create (self-contained mint
// + persist). Their foreign keys are same-source FINDS (ADR 0016 #4/#9): because
// the source emits referenced entities first, the target facade already exists;
// the resolver locates it and awaits its `id`, failing fast and loud when the
// target is absent (a forward-reference violation) rather than minting a stub.

/** The database row shape a `LicenseFacade` resolves toward. */
export type LicenseRowShape = {
  id: string;
  officer_id: string;
  license_type: string;
  status: string | null;
  first_awarded: string | null;
  issued_by_authority_id: string;
};

/** The database row shape a `LicenseActionFacade` resolves toward. */
export type LicenseActionRowShape = {
  id: string;
  license_id: string;
  action: string;
  action_date: string | null;
  status: string | null;
};

/**
 * Backend capabilities the License / LicenseAction resolvers reach through:
 * the entity's own canonical-id find-or-create, the existing DB row for
 * create-vs-update, and the same-source foreign-key find.
 */
export type LicenseResolverBackend = {
  findOrCreateCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string>;
  getCurrentById(id: string): Record<string, unknown> | undefined;
  /**
   * Locate an already-emitted target facade by `(kind, namespace, source-id)`
   * so a FK resolver can await its `id`. Returns undefined when no such facade
   * exists — the resolver turns that into a loud forward-reference failure.
   */
  findForeignKeyTarget(input: {
    kind: string;
    namespace: string;
    sourceId: string;
  }): ForeignKeyIdSource | undefined;
};

/**
 * The minimal capability a canonical-id resolver reaches through: the durable
 * ledger find-or-create. Backend-generic so any entity's facade (License,
 * LicenseAction, Personnel, …) can reuse the same resolver.
 */
type CanonicalIdBackend = {
  findOrCreateCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string>;
};

/** Canonical-id find-or-create resolver for an entity `kind` (ADR 0016 #4). */
function facadeCanonicalIdResolver<
  Row,
  Backend extends CanonicalIdBackend = LicenseResolverBackend,
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
function facadeForeignKeyResolver<Row>(
  entityKind: string,
  property: keyof Row & string,
  targetKind: string,
): Resolver<string, ResolverContext<Row, LicenseResolverBackend>> {
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
        `Cannot resolve ${entityKind}.${property} for ${source.namespace}/${source.name}; no ${targetKind} facade was emitted for source id ${JSON.stringify(
          sourceId,
        )} (forward reference — ADR 0016 #9).`,
      );
    }
    return target.value("id");
  });
}

type LicenseResolvers = Partial<{
  [K in keyof LicenseRowShape]: Resolver<
    LicenseRowShape[K],
    ResolverContext<LicenseRowShape, LicenseResolverBackend>
  >;
}>;

type LicenseActionResolvers = Partial<{
  [K in keyof LicenseActionRowShape]: Resolver<
    LicenseActionRowShape[K],
    ResolverContext<LicenseActionRowShape, LicenseResolverBackend>
  >;
}>;

export class LicenseFacade
  implements PropertyResolutionFacade<LicenseRowShape>
{
  private static readonly kind = "License";
  private readonly current?: Record<string, unknown>;
  private readonly spec: Record<string, unknown> = {};
  private readonly source: FacadeSource;
  private readonly backend: LicenseResolverBackend;
  private readonly resolvers: LicenseResolvers;
  private readonly memo = new Map<keyof LicenseRowShape, Promise<unknown>>();
  private readonly inProgress = new Set<keyof LicenseRowShape>();

  constructor(options: {
    current?: Record<string, unknown>;
    source: FacadeSource;
    backend: LicenseResolverBackend;
  }) {
    this.current = options.current;
    this.source = options.source;
    this.backend = options.backend;
    this.resolvers = {
      id: facadeCanonicalIdResolver<LicenseRowShape>(LicenseFacade.kind),
      officer_id: facadeForeignKeyResolver<LicenseRowShape>(
        LicenseFacade.kind,
        "officer_id",
        "Personnel",
      ),
      issued_by_authority_id: facadeForeignKeyResolver<LicenseRowShape>(
        LicenseFacade.kind,
        "issued_by_authority_id",
        "LicensingAuthority",
      ),
    };
  }

  merge(spec: Record<string, unknown>): void {
    Object.assign(this.spec, spec);
  }

  raw(property: keyof LicenseRowShape): unknown {
    return this.spec[property as string];
  }

  value<K extends keyof LicenseRowShape>(
    property: K,
  ): Promise<LicenseRowShape[K]> {
    const cached = this.memo.get(property);
    if (cached !== undefined) {
      return cached as Promise<LicenseRowShape[K]>;
    }
    const pending = this.computeValue(property);
    this.memo.set(property, pending);
    return pending;
  }

  private async computeValue<K extends keyof LicenseRowShape>(
    property: K,
  ): Promise<LicenseRowShape[K]> {
    if (this.inProgress.has(property)) {
      throw new Error(
        `Circular property dependency while resolving ${LicenseFacade.kind}.${String(
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

  private plainValue<K extends keyof LicenseRowShape>(
    property: K,
  ): LicenseRowShape[K] {
    const value = this.spec[property as string];
    return (value === undefined ? null : value) as LicenseRowShape[K];
  }

  private unresolvedMessage(property: keyof LicenseRowShape): string {
    return `Cannot resolve ${LicenseFacade.kind}.${String(
      property,
    )} for source ${this.source.namespace}/${this.source.name}; offending value ${JSON.stringify(
      this.spec[property as string],
    )}.`;
  }

  async toMutation(): Promise<LicenseCreateEnvelope | LicenseUpdateEnvelope> {
    const id = await this.value("id");
    const officerId = await this.value("officer_id");
    const licenseType = await this.value("license_type");
    const status = await this.value("status");
    const firstAwarded = await this.value("first_awarded");
    const issuedByAuthorityId = await this.value("issued_by_authority_id");

    const current = this.current ?? this.backend.getCurrentById(id);

    if (current === undefined) {
      return LicenseCreate.new({
        metadata: {
          namespace: this.source.namespace,
          name: this.source.name,
        },
        spec: {
          id,
          officer_id: officerId,
          license_type: licenseType,
          status,
          first_awarded: firstAwarded,
          issued_by_authority_id: issuedByAuthorityId,
        } as Parameters<typeof LicenseCreate.new>[0]["spec"],
      });
    }

    const commandName = valueAsString(this.source.commandName);
    if (commandName === undefined) {
      throw new Error(
        `Cannot create license update for ${this.source.namespace}/${this.source.name} without command name.`,
      );
    }

    const source = {
      namespace: this.source.namespace,
      command: { name: commandName },
      kind: LicenseFacade.kind,
      name: this.source.name,
    };
    const desired: Record<string, unknown> = {
      officer_id: officerId,
      license_type: licenseType,
      status,
      first_awarded: firstAwarded,
      issued_by_authority_id: issuedByAuthorityId,
    };
    const operations = Object.entries(desired).map(([path, to]) => {
      const from = current[path];
      if (Object.is(from, to)) {
        return {
          action: "check" as const,
          path,
          value: to,
          reason: `Expected existing ${LicenseFacade.kind} ${path}.`,
          source,
        };
      }

      return {
        action: "set" as const,
        path,
        from,
        to,
        reason: `Set ${LicenseFacade.kind} ${path}.`,
        source,
      };
    });

    return LicenseUpdate.new({
      metadata: {
        namespace: this.source.namespace,
        name: this.source.name,
      },
      spec: { operations },
    });
  }
}

export class LicenseActionFacade
  implements PropertyResolutionFacade<LicenseActionRowShape>
{
  private static readonly kind = "LicenseAction";
  private readonly current?: Record<string, unknown>;
  private readonly spec: Record<string, unknown> = {};
  private readonly source: FacadeSource;
  private readonly backend: LicenseResolverBackend;
  private readonly resolvers: LicenseActionResolvers;
  private readonly memo = new Map<
    keyof LicenseActionRowShape,
    Promise<unknown>
  >();
  private readonly inProgress = new Set<keyof LicenseActionRowShape>();

  constructor(options: {
    current?: Record<string, unknown>;
    source: FacadeSource;
    backend: LicenseResolverBackend;
  }) {
    this.current = options.current;
    this.source = options.source;
    this.backend = options.backend;
    this.resolvers = {
      id: facadeCanonicalIdResolver<LicenseActionRowShape>(
        LicenseActionFacade.kind,
      ),
      license_id: facadeForeignKeyResolver<LicenseActionRowShape>(
        LicenseActionFacade.kind,
        "license_id",
        "License",
      ),
    };
  }

  merge(spec: Record<string, unknown>): void {
    Object.assign(this.spec, spec);
  }

  raw(property: keyof LicenseActionRowShape): unknown {
    return this.spec[property as string];
  }

  value<K extends keyof LicenseActionRowShape>(
    property: K,
  ): Promise<LicenseActionRowShape[K]> {
    const cached = this.memo.get(property);
    if (cached !== undefined) {
      return cached as Promise<LicenseActionRowShape[K]>;
    }
    const pending = this.computeValue(property);
    this.memo.set(property, pending);
    return pending;
  }

  private async computeValue<K extends keyof LicenseActionRowShape>(
    property: K,
  ): Promise<LicenseActionRowShape[K]> {
    if (this.inProgress.has(property)) {
      throw new Error(
        `Circular property dependency while resolving ${LicenseActionFacade.kind}.${String(
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

  private plainValue<K extends keyof LicenseActionRowShape>(
    property: K,
  ): LicenseActionRowShape[K] {
    const value = this.spec[property as string];
    return (value === undefined ? null : value) as LicenseActionRowShape[K];
  }

  private unresolvedMessage(property: keyof LicenseActionRowShape): string {
    return `Cannot resolve ${LicenseActionFacade.kind}.${String(
      property,
    )} for source ${this.source.namespace}/${this.source.name}; offending value ${JSON.stringify(
      this.spec[property as string],
    )}.`;
  }

  async toMutation(): Promise<
    LicenseActionCreateEnvelope | LicenseActionUpdateEnvelope
  > {
    const id = await this.value("id");
    const licenseId = await this.value("license_id");
    const action = await this.value("action");
    const actionDate = await this.value("action_date");
    const status = await this.value("status");

    const current = this.current ?? this.backend.getCurrentById(id);

    if (current === undefined) {
      return LicenseActionCreate.new({
        metadata: {
          namespace: this.source.namespace,
          name: this.source.name,
        },
        spec: {
          id,
          license_id: licenseId,
          action,
          action_date: actionDate,
          status,
        } as Parameters<typeof LicenseActionCreate.new>[0]["spec"],
      });
    }

    const commandName = valueAsString(this.source.commandName);
    if (commandName === undefined) {
      throw new Error(
        `Cannot create license action update for ${this.source.namespace}/${this.source.name} without command name.`,
      );
    }

    const source = {
      namespace: this.source.namespace,
      command: { name: commandName },
      kind: LicenseActionFacade.kind,
      name: this.source.name,
    };
    const desired: Record<string, unknown> = {
      license_id: licenseId,
      action,
      action_date: actionDate,
      status,
    };
    const operations = Object.entries(desired).map(([path, to]) => {
      const from = current[path];
      if (Object.is(from, to)) {
        return {
          action: "check" as const,
          path,
          value: to,
          reason: `Expected existing ${LicenseActionFacade.kind} ${path}.`,
          source,
        };
      }

      return {
        action: "set" as const,
        path,
        from,
        to,
        reason: `Set ${LicenseActionFacade.kind} ${path}.`,
        source,
      };
    });

    return LicenseActionUpdate.new({
      metadata: {
        namespace: this.source.namespace,
        name: this.source.name,
      },
      spec: { operations },
    });
  }
}

// --- Personnel facade (ADR 0016) ---------------------------------------------
//
// Personnel mirrors the License family: `id` is a canonical-id find-or-create
// (self-contained mint + persist), name fields are plain, and `slug` is a
// generate-unique resolver — resolve if the source supplied one, else reuse the
// existing DB row's slug (stability across a name change), else derive a base
// slug and disambiguate so it is unique across the three resolution levels
// (entities planned earlier in the current command, intake-owned state, and the
// database). This folds the former `validate-new-slug-conflicts` officer check
// into the resolver.

/** The database row shape a `PersonnelFacade` resolves toward (public.officers). */
export type PersonnelRowShape = {
  id: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  prefix: string | null;
  suffix: string | null;
  slug: string;
};

/**
 * Backend capabilities the Personnel resolvers reach through: the entity's own
 * canonical-id find-or-create, the existing DB row for create-vs-update, and the
 * three-level unique-slug generator.
 */
export type PersonnelResolverBackend = {
  findOrCreateCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string>;
  getCurrentById(id: string): Record<string, unknown> | undefined;
  /**
   * Given a base slug and the owning canonical id, return a slug guaranteed
   * unique across all three resolution levels — appending a numeric suffix when
   * the base (or a prior candidate) is already claimed by a different id — and
   * register the claim for the rest of this command.
   */
  ensureUniquePersonnelSlug(input: {
    base: string;
    canonicalId: string;
  }): Promise<string>;
  /**
   * Register a slug that was resolved without generation (an explicit source
   * slug or a reused existing DB slug), so a later generated slug in the same
   * command disambiguates away from it.
   */
  registerPersonnelSlug(input: { slug: string; canonicalId: string }): void;
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

/** Generate-unique slug resolver for Personnel (ADR 0016 #4, generated value). */
function personnelSlugResolver(): Resolver<
  string,
  ResolverContext<PersonnelRowShape, PersonnelResolverBackend>
> {
  return new Resolver(async ({ facade, source, backend }) => {
    // Resolve: an explicitly-supplied slug wins.
    const explicitId = await facade.value("id");
    const explicit = valueAsString(facade.raw("slug"));
    if (explicit !== undefined) {
      backend.registerPersonnelSlug({ slug: explicit, canonicalId: explicitId });
      return explicit;
    }
    // Stability: reuse the existing DB row's slug so a corrected name does not
    // change an officer's slug.
    const id = explicitId;
    const current = backend.getCurrentById(id);
    const currentSlug =
      current === undefined ? undefined : valueAsString(current.slug);
    if (currentSlug !== undefined) {
      backend.registerPersonnelSlug({ slug: currentSlug, canonicalId: id });
      return currentSlug;
    }
    // Generate: derive a base from name + canonical-id suffix, then disambiguate
    // for uniqueness across all three levels.
    const firstName = valueAsString(facade.raw("first_name"));
    const lastName = valueAsString(facade.raw("last_name"));
    if (firstName === undefined || lastName === undefined) {
      throw new Error(
        `Cannot generate slug for Personnel ${source.namespace}/${source.name}; first_name and last_name are required.`,
      );
    }
    const base = `${slugify(`${firstName} ${lastName}`)}-${canonicalSuffix(id)}`;
    return backend.ensureUniquePersonnelSlug({ base, canonicalId: id });
  });
}

type PersonnelResolvers = Partial<{
  [K in keyof PersonnelRowShape]: Resolver<
    PersonnelRowShape[K],
    ResolverContext<PersonnelRowShape, PersonnelResolverBackend>
  >;
}>;

export class PersonnelFacade
  implements PropertyResolutionFacade<PersonnelRowShape>
{
  private static readonly kind = "Personnel";
  private readonly current?: Record<string, unknown>;
  private readonly spec: Record<string, unknown> = {};
  private readonly source: FacadeSource;
  private readonly backend: PersonnelResolverBackend;
  private readonly resolvers: PersonnelResolvers;
  private readonly memo = new Map<keyof PersonnelRowShape, Promise<unknown>>();
  private readonly inProgress = new Set<keyof PersonnelRowShape>();

  constructor(options: {
    current?: Record<string, unknown>;
    source: FacadeSource;
    backend: PersonnelResolverBackend;
  }) {
    this.current = options.current;
    this.source = options.source;
    this.backend = options.backend;
    this.resolvers = {
      id: facadeCanonicalIdResolver<PersonnelRowShape, PersonnelResolverBackend>(
        PersonnelFacade.kind,
      ),
      slug: personnelSlugResolver(),
    };
  }

  merge(spec: Record<string, unknown>): void {
    Object.assign(this.spec, spec);
  }

  raw(property: keyof PersonnelRowShape): unknown {
    return this.spec[property as string];
  }

  value<K extends keyof PersonnelRowShape>(
    property: K,
  ): Promise<PersonnelRowShape[K]> {
    const cached = this.memo.get(property);
    if (cached !== undefined) {
      return cached as Promise<PersonnelRowShape[K]>;
    }
    const pending = this.computeValue(property);
    this.memo.set(property, pending);
    return pending;
  }

  private async computeValue<K extends keyof PersonnelRowShape>(
    property: K,
  ): Promise<PersonnelRowShape[K]> {
    if (this.inProgress.has(property)) {
      throw new Error(
        `Circular property dependency while resolving ${PersonnelFacade.kind}.${String(
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

  private plainValue<K extends keyof PersonnelRowShape>(
    property: K,
  ): PersonnelRowShape[K] {
    const value = this.spec[property as string];
    return (value === undefined ? null : value) as PersonnelRowShape[K];
  }

  private unresolvedMessage(property: keyof PersonnelRowShape): string {
    return `Cannot resolve ${PersonnelFacade.kind}.${String(
      property,
    )} for source ${this.source.namespace}/${this.source.name}; offending value ${JSON.stringify(
      this.spec[property as string],
    )}.`;
  }

  async toMutation(): Promise<
    PersonnelCreateEnvelope | PersonnelUpdateEnvelope
  > {
    const id = await this.value("id");
    const firstName = await this.value("first_name");
    const lastName = await this.value("last_name");
    const middleName = await this.value("middle_name");
    const prefix = await this.value("prefix");
    const suffix = await this.value("suffix");
    const slug = await this.value("slug");

    const current = this.current ?? this.backend.getCurrentById(id);

    if (current === undefined) {
      return PersonnelCreate.new({
        metadata: {
          namespace: this.source.namespace,
          name: this.source.name,
        },
        spec: {
          id,
          first_name: firstName,
          last_name: lastName,
          middle_name: middleName,
          prefix,
          suffix,
          slug,
        } as Parameters<typeof PersonnelCreate.new>[0]["spec"],
      });
    }

    const commandName = valueAsString(this.source.commandName);
    if (commandName === undefined) {
      throw new Error(
        `Cannot create personnel update for ${this.source.namespace}/${this.source.name} without command name.`,
      );
    }

    const source = {
      namespace: this.source.namespace,
      command: { name: commandName },
      kind: PersonnelFacade.kind,
      name: this.source.name,
    };
    const desired: Record<string, unknown> = {
      first_name: firstName,
      last_name: lastName,
      middle_name: middleName,
      prefix,
      suffix,
      slug,
    };
    const operations = Object.entries(desired).map(([path, to]) => {
      const from = current[path];
      if (Object.is(from, to)) {
        return {
          action: "check" as const,
          path,
          value: to,
          reason: `Expected existing ${PersonnelFacade.kind} ${path}.`,
          source,
        };
      }

      return {
        action: "set" as const,
        path,
        from,
        to,
        reason: `Set ${PersonnelFacade.kind} ${path}.`,
        source,
      };
    });

    return PersonnelUpdate.new({
      metadata: {
        namespace: this.source.namespace,
        name: this.source.name,
      },
      spec: { operations },
    });
  }
}

// --- Agency facade (ADR 0016) ------------------------------------------------
//
// Agency mirrors the other facades: `id` is a canonical-id find-or-create; name
// and contact fields are plain; `slug` is a generate-unique resolver (reuse an
// explicit or existing-DB slug, else derive + disambiguate across the three
// levels); `location_path_id` is a COMPOSITION resolver — geocode the address
// (reusing the durable ResolvedProperty coordinate cache) then point-in-polygon
// containment, resolve-or-fail (ADR 0006/0015), never minted. `latitude` /
// `longitude` fall out of the same geocode.
//
// COEXISTENCE (flagged): eager agency resolution, the excluded-agency cascade,
// the batched geocode pass, slug-conflict validation, and fail-loud aggregation
// with the DatabaseMutationsDebug envelope still run in the planning pass on the
// `AgencyRow` transform rows (see plan-database-mutations.ts / agency-*.ts). The
// planning pass writes the resolved location_path_id / slug / coordinates into
// the row, which `mergeAgencyArtifacts` merges into the facade spec — so these
// resolvers take the resolve-if-present branch in production today. The
// composition / generate branches are the intended active path once that eager
// pass is folded into the flush/transaction script (ADR 0017); they are proven
// by the facade unit tests. `AgencyRow` and the agency classify loop/count are
// retained as coexistence for the same reason.

/** The database row shape an `AgencyFacade` resolves toward (public.agency). */
export type AgencyRowShape = {
  id: string;
  name: string;
  city: string | null;
  state: string;
  address: string | null;
  zip_code: string | null;
  contact_name: string | null;
  contact_email: string | null;
  slug: string;
  location_path_id: string;
  latitude: number;
  longitude: number;
  addresses?: Record<string, unknown>;
  emails?: Record<string, unknown>;
  location?: Record<string, unknown>;
  phones?: Record<string, unknown>;
  urls?: Record<string, unknown>;
};

/** Backend capabilities the Agency resolvers reach through. */
export type AgencyResolverBackend = {
  findOrCreateCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string>;
  getCurrentById(id: string): Record<string, unknown> | undefined;
  ensureUniqueAgencySlug(input: {
    base: string;
    canonicalId: string;
  }): Promise<string>;
  registerAgencySlug(input: { slug: string; canonicalId: string }): void;
  /**
   * Compose an address into a canonical location: geocode (cached coordinates)
   * then point-in-polygon containment. Throws (resolve-or-fail) when the address
   * cannot be geocoded or no boundary contains the resolved point.
   */
  resolveAgencyLocation(input: ResolveAddressInput): Promise<LocationResolution>;
};

/** The columns that are pass-through source metadata (public.agency jsonb). */
const AGENCY_METADATA_COLUMNS = [
  "addresses",
  "emails",
  "location",
  "phones",
  "urls",
] as const;

/** The scalar database columns the AgencyFacade resolves and writes, in order. */
const AGENCY_SCALAR_COLUMNS = [
  "name",
  "city",
  "state",
  "address",
  "zip_code",
  "contact_name",
  "contact_email",
  "slug",
  "location_path_id",
  "latitude",
  "longitude",
] as const satisfies readonly (keyof AgencyRowShape)[];

function agencyAddressInput(
  facade: PropertyResolutionFacade<AgencyRowShape>,
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
function agencyLocationPathResolver(): Resolver<
  string,
  ResolverContext<AgencyRowShape, AgencyResolverBackend>
> {
  return new Resolver(async ({ facade, backend, source }) => {
    const present = valueAsString(facade.raw("location_path_id"));
    if (present !== undefined) {
      return present;
    }
    // Stability: an existing agency keeps its current location rather than
    // being re-geocoded on update.
    const id = await facade.value("id");
    const current = backend.getCurrentById(id);
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

function agencyCoordinateResolver(
  field: "addressLatitude" | "addressLongitude",
  column: "latitude" | "longitude",
): Resolver<number, ResolverContext<AgencyRowShape, AgencyResolverBackend>> {
  return new Resolver(async ({ facade, backend, source }) => {
    const present = valueAsFiniteNumber(facade.raw(column));
    if (present !== undefined) {
      return present;
    }
    const id = await facade.value("id");
    const current = backend.getCurrentById(id);
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

/** Generate-unique slug resolver for Agency (mirrors Personnel). */
function agencySlugResolver(): Resolver<
  string,
  ResolverContext<AgencyRowShape, AgencyResolverBackend>
> {
  return new Resolver(async ({ facade, source, backend }) => {
    const id = await facade.value("id");
    const explicit = valueAsString(facade.raw("slug"));
    if (explicit !== undefined) {
      backend.registerAgencySlug({ slug: explicit, canonicalId: id });
      return explicit;
    }
    const current = backend.getCurrentById(id);
    const currentSlug =
      current === undefined ? undefined : valueAsString(current.slug);
    if (currentSlug !== undefined) {
      backend.registerAgencySlug({ slug: currentSlug, canonicalId: id });
      return currentSlug;
    }
    const name = valueAsString(facade.raw("name"));
    if (name === undefined) {
      throw new Error(
        `Cannot generate slug for Agency ${source.namespace}/${source.name}; name is required.`,
      );
    }
    const base = slugify(name);
    return backend.ensureUniqueAgencySlug({ base, canonicalId: id });
  });
}

type AgencyResolvers = Partial<{
  [K in keyof AgencyRowShape]: Resolver<
    AgencyRowShape[K],
    ResolverContext<AgencyRowShape, AgencyResolverBackend>
  >;
}>;

export class AgencyFacade implements PropertyResolutionFacade<AgencyRowShape> {
  private static readonly kind = "Agency";
  private readonly current?: Record<string, unknown>;
  private readonly spec: Record<string, unknown> = {};
  private readonly source: FacadeSource;
  private readonly backend: AgencyResolverBackend;
  private readonly resolvers: AgencyResolvers;
  private readonly memo = new Map<keyof AgencyRowShape, Promise<unknown>>();
  private readonly inProgress = new Set<keyof AgencyRowShape>();

  constructor(options: {
    current?: Record<string, unknown>;
    source: FacadeSource;
    backend: AgencyResolverBackend;
  }) {
    this.current = options.current;
    this.source = options.source;
    this.backend = options.backend;
    this.resolvers = {
      id: facadeCanonicalIdResolver<AgencyRowShape, AgencyResolverBackend>(
        AgencyFacade.kind,
      ),
      slug: agencySlugResolver(),
      location_path_id: agencyLocationPathResolver(),
      latitude: agencyCoordinateResolver("addressLatitude", "latitude"),
      longitude: agencyCoordinateResolver("addressLongitude", "longitude"),
    };
  }

  merge(spec: Record<string, unknown>): void {
    Object.assign(this.spec, spec);
  }

  raw(property: keyof AgencyRowShape): unknown {
    return this.spec[property as string];
  }

  value<K extends keyof AgencyRowShape>(
    property: K,
  ): Promise<AgencyRowShape[K]> {
    const cached = this.memo.get(property);
    if (cached !== undefined) {
      return cached as Promise<AgencyRowShape[K]>;
    }
    const pending = this.computeValue(property);
    this.memo.set(property, pending);
    return pending;
  }

  private async computeValue<K extends keyof AgencyRowShape>(
    property: K,
  ): Promise<AgencyRowShape[K]> {
    if (this.inProgress.has(property)) {
      throw new Error(
        `Circular property dependency while resolving ${AgencyFacade.kind}.${String(
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

  private plainValue<K extends keyof AgencyRowShape>(
    property: K,
  ): AgencyRowShape[K] {
    const value = this.spec[property as string];
    return (value === undefined ? null : value) as AgencyRowShape[K];
  }

  private unresolvedMessage(property: keyof AgencyRowShape): string {
    return `Cannot resolve ${AgencyFacade.kind}.${String(
      property,
    )} for source ${this.source.namespace}/${this.source.name}; offending value ${JSON.stringify(
      this.spec[property as string],
    )}.`;
  }

  /** Present pass-through metadata columns (omitted when absent, never null). */
  private metadataSpec(): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};
    for (const column of AGENCY_METADATA_COLUMNS) {
      const value = valueAsRecordOrUndefined(this.spec[column]);
      if (value !== undefined) {
        metadata[column] = value;
      }
    }
    return metadata;
  }

  async toMutation(): Promise<AgencyCreateEnvelope | AgencyUpdateEnvelope> {
    const id = await this.value("id");
    const scalars: Record<string, unknown> = {};
    for (const column of AGENCY_SCALAR_COLUMNS) {
      scalars[column] = await this.value(column);
    }
    const desired: Record<string, unknown> = {
      ...scalars,
      ...this.metadataSpec(),
    };

    const current = this.current ?? this.backend.getCurrentById(id);

    if (current === undefined) {
      return AgencyCreate.new({
        metadata: {
          namespace: this.source.namespace,
          name: this.source.name,
        },
        spec: {
          id,
          ...desired,
        } as Parameters<typeof AgencyCreate.new>[0]["spec"],
      });
    }

    const commandName = valueAsString(this.source.commandName);
    if (commandName === undefined) {
      throw new Error(
        `Cannot create agency update for ${this.source.namespace}/${this.source.name} without command name.`,
      );
    }

    const source = {
      namespace: this.source.namespace,
      command: { name: commandName },
      kind: AgencyFacade.kind,
      name: this.source.name,
    };
    const operations = Object.entries(desired).map(([path, to]) => {
      const from = current[path];
      if (Object.is(from, to)) {
        return {
          action: "check" as const,
          path,
          value: to,
          reason: `Expected existing ${AgencyFacade.kind} ${path}.`,
          source,
        };
      }

      return {
        action: "set" as const,
        path,
        from,
        to,
        reason: `Set ${AgencyFacade.kind} ${path}.`,
        source,
      };
    });

    return AgencyUpdate.new({
      metadata: {
        namespace: this.source.namespace,
        name: this.source.name,
      },
      spec: { operations },
    });
  }
}

export type LocationAdministrativeAreaRequest = {
  address?: string;
  state: string;
  placeName: string;
  placeSlug: string;
  zipCode?: string;
};

export type LocationAdministrativeAreaResolution = {
  administrativeAreaName: string;
  administrativeAreaSlug?: string;
};

export type AddressResolutionRequest = {
  entityType: string;
  entityId: string;
  sourceName?: string;
  name?: string;
  address: string;
  place: string;
  state: string;
  zipCode: string;
  administrativeAreaName?: string;
  administrativeAreaSlug?: string;
  latitude?: number;
  longitude?: number;
};

export type AddressResolution = {
  latitude: number;
  longitude: number;
};

export type LocationResolution = {
  locationPathId: string;
  addressLatitude: number;
  addressLongitude: number;
};

export type ResolveAddressInput = {
  entityType: string;
  entityId: string;
  state?: string;
  place?: string;
  zipCode?: string;
  address?: string;
  administrativeAreaName?: string;
  administrativeAreaSlug?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
  sourceName?: string;
  preferredLocationPathId?: string;
};

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

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

function normalizeAddressToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function zip5(value: string): string {
  return value.trim().slice(0, 5);
}

const POSTAL_AREA_PLACE_PATHS: readonly {
  state: string;
  zip5: string;
  places: readonly string[];
  paths: readonly string[];
}[] = [
  {
    state: "MN",
    zip5: "55111",
    places: ["st paul", "saint paul", "stpaul"],
    paths: ["/mn/ramsey-county/st-paul/", "/mn/ramsey-county/saint-paul/"],
  },
  {
    state: "MN",
    zip5: "55450",
    places: ["minneapolis"],
    paths: ["/mn/hennepin-county/minneapolis/"],
  },
  {
    state: "MN",
    zip5: "55804",
    places: ["duluth"],
    paths: ["/mn/st-louis-county/duluth/"],
  },
  {
    state: "MN",
    zip5: "56270",
    places: ["morton"],
    paths: ["/mn/renville-county/morton/"],
  },
  {
    state: "MN",
    zip5: "56241",
    places: ["granite falls"],
    paths: ["/mn/chippewa-county/granite-falls/"],
  },
];

function postalAreaPlacePaths(request: AddressResolutionRequest): string[] {
  const state = request.state.trim().toUpperCase();
  const normalizedPlace = normalizeAddressToken(request.place);
  const postalZip = zip5(request.zipCode);
  const rule = POSTAL_AREA_PLACE_PATHS.find(
    (candidate) =>
      candidate.state === state &&
      candidate.zip5 === postalZip &&
      candidate.places.includes(normalizedPlace),
  );

  return rule === undefined ? [] : [...rule.paths];
}

const CONTAINING_POINT_LEVELS = [
  "place",
  "administrative_area",
  "state",
] as const;

function isMissingContainingPlaceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("no place location_path_geometry boundary contains")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstZodIssuePath(
  result: ReturnType<typeof LocationPathSpec.safeParse>,
): string {
  return result.success
    ? "record"
    : result.error.issues[0]?.path.join(".") || "record";
}

function malformedLocationPathMessage(locationPath: LocationPathRow): string {
  const result = LocationPathSpec.safeParse(locationPath);
  return result.success
    ? ""
    : `Cannot prepare public.location_path ${locationPath.location_path_id}; location path is malformed at ${firstZodIssuePath(result)}.`;
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function mostCommonColumns<TColumn extends string>(
  columnsByRecordName: Record<string, readonly TColumn[]>,
): TColumn[] | undefined {
  const counts = new Map<string, { columns: TColumn[]; count: number }>();

  for (const columns of Object.values(columnsByRecordName)) {
    const key = JSON.stringify(columns);
    const current = counts.get(key);
    if (current === undefined) {
      counts.set(key, { columns: [...columns], count: 1 });
    } else {
      current.count += 1;
    }
  }

  return [...counts.values()].sort((left, right) => right.count - left.count)[0]
    ?.columns;
}

function ownedColumnsMetadata(records: ImportRows): OwnedColumnsMetadata {
  return {
    agency: mostCommonColumns(records.ownedColumns.agencies),
    agencyPersonnel: mostCommonColumns(records.ownedColumns.agencyOfficers),
  };
}

function recordOwnedColumns<T extends readonly string[]>(
  ownedColumns: T,
  defaultOwnedColumns: readonly string[] | undefined,
): T | undefined {
  return defaultOwnedColumns !== undefined &&
    arraysEqual(ownedColumns, defaultOwnedColumns)
    ? undefined
    : ownedColumns;
}

function mutationKind(
  operation: ImportOperation | undefined,
  recordKind: string,
): string {
  const resolvedOperation = operation ?? "create";
  return `${recordKind}${resolvedOperation[0]!.toUpperCase()}${resolvedOperation.slice(1)}`;
}

function databaseSpec(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const { sourceName, ...spec } = record;
  return spec;
}

function databaseMutationSpec(
  operation: ImportOperation | undefined,
  record: Record<string, unknown>,
): Record<string, unknown> {
  return operation === undefined || operation === "create"
    ? databaseSpec(record)
    : {};
}

function valueAsRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error("Artifacts agency record must be an object.");
}

function preparedAgencySpec(agency: AgencyRow): Record<string, unknown> {
  const { id: _id, sourceName: _sourceName, ...spec } = agency;
  return Object.fromEntries(
    Object.entries(spec).filter(([, value]) => value !== undefined),
  );
}

export class DataContext {
  readonly locations: LocationDataContext;
  readonly locationPaths: LocationPathDataContext;
  private readonly client?: DatabaseClient;
  readonly logger?: DataContextLogger;
  private readonly addressResolutionCache = new Map<
    string,
    LocationResolution
  >();
  private readonly databaseLocationPathsLoaded: boolean;
  private readonly databaseLocationPathById?: Map<string, LocationPathRow>;
  private readonly databaseLocationPathByPath?: Map<string, LocationPathRow>;
  private readonly databaseLocationPathIdByAliasPath?: Map<string, string>;
  private readonly entityResolvers?: DataContextOptions["entityResolvers"];
  private readonly importRows: ImportRows;
  private readonly operations: ImportOperations;
  private readonly loadLocationPathById?: DataContextOptions["loadLocationPathById"];
  private readonly loadLocationPathByPath?: DataContextOptions["loadLocationPathByPath"];
  private readonly resolveAddressFn?: DataContextOptions["resolveAddress"];
  private readonly resolveAdministrativeArea?: DataContextOptions["resolveAdministrativeArea"];
  private readonly agencyFieldResolutionOptions?: AgencyFieldResolutionOptions;
  private readonly resolvedProperties?: ResolvedProperties;
  private readonly commandName?: string;
  private readonly sourceNameToCanonicalIds?: SourceNameToCanonicalIds;
  private readonly databaseAgencyById: Map<string, Record<string, unknown>>;
  private readonly databaseOfficerById: Map<string, Record<string, unknown>>;
  private readonly databaseLicensingAuthorityById: Map<
    string,
    Record<string, unknown>
  >;
  private readonly databaseLicenseById: Map<string, Record<string, unknown>>;
  /** per-table current-command slug → owning canonical id (uniqueness level 1). */
  private readonly slugClaimsByTable = new Map<
    SlugTableName,
    Map<string, string>
  >();
  /** per-table memoized DB slug → owning id (null = unused), queried once. */
  private readonly slugDatabaseOwnerByTable = new Map<
    SlugTableName,
    Map<string, string | null>
  >();
  private readonly databaseLicenseActionById: Map<
    string,
    Record<string, unknown>
  >;
  private readonly persistSourceNameToCanonicalIdsFn?: DataContextOptions["persistSourceNameToCanonicalIds"];
  private readonly agencyFacades = new Map<string, AgencyFacade>();
  private readonly personnelFacades = new Map<string, PersonnelFacade>();
  private readonly agencyPersonnelFacades = new Map<
    string,
    FacadeEntry<AgencyPersonnelFacade>
  >();
  private readonly licensingAuthorityFacades = new Map<
    string,
    LicensingAuthorityFacade
  >();
  private readonly licenseFacades = new Map<string, LicenseFacade>();
  private readonly licenseActionFacades = new Map<
    string,
    LicenseActionFacade
  >();

  constructor(options: DataContextOptions) {
    this.client = options.client;
    this.importRows = options.rows;
    this.logger = options.logger;
    this.operations = options.operations ?? {
      locationPaths: {},
      locationPathGeometries: {},
      locationPathAliases: {},
      agencies: {},
      officers: {},
      agencyOfficers: {},
      licensingAuthorities: {},
      licenses: {},
      licenseActions: {},
    };
    this.databaseLocationPathsLoaded =
      options.databaseLocationPaths !== undefined;
    this.databaseLocationPathById =
      options.databaseLocationPaths === undefined
        ? undefined
        : new Map(
            options.databaseLocationPaths.map((locationPath) => [
              locationPath.location_path_id,
              locationPath,
            ]),
          );
    this.databaseLocationPathByPath =
      options.databaseLocationPaths === undefined
        ? undefined
        : new Map(
            options.databaseLocationPaths.map((locationPath) => [
              locationPath.path,
              locationPath,
            ]),
          );
    this.databaseLocationPathIdByAliasPath =
      options.databaseLocationPathAliases === undefined
        ? undefined
        : new Map(
            options.databaseLocationPathAliases.map((locationPathAlias) => [
              locationPathAlias.alias_path,
              locationPathAlias.location_path_id,
            ]),
          );
    this.entityResolvers = options.entityResolvers;
    this.loadLocationPathById = options.loadLocationPathById;
    this.loadLocationPathByPath = options.loadLocationPathByPath;
    this.resolveAddressFn = options.resolveAddress;
    this.resolveAdministrativeArea = options.resolveAdministrativeArea;
    this.agencyFieldResolutionOptions = options.agencyFieldResolutionOptions;
    this.resolvedProperties = options.resolvedProperties;
    this.commandName = options.commandName;
    this.sourceNameToCanonicalIds = options.sourceNameToCanonicalIds;
    this.databaseAgencyById = new Map(
      (options.databaseAgencies ?? [])
        .map((agency) => [valueAsString(agency.id), agency] as const)
        .filter(
          (entry): entry is readonly [string, Record<string, unknown>] =>
            entry[0] !== undefined,
        ),
    );
    this.databaseOfficerById = new Map(
      (options.databaseOfficers ?? [])
        .map((officer) => [valueAsString(officer.id), officer] as const)
        .filter(
          (entry): entry is readonly [string, Record<string, unknown>] =>
            entry[0] !== undefined,
        ),
    );
    this.databaseLicensingAuthorityById = new Map(
      (options.databaseLicensingAuthorities ?? [])
        .map((authority) => [valueAsString(authority.id), authority] as const)
        .filter(
          (entry): entry is readonly [string, Record<string, unknown>] =>
            entry[0] !== undefined,
        ),
    );
    this.databaseLicenseById = new Map(
      (options.databaseLicenses ?? [])
        .map((license) => [valueAsString(license.id), license] as const)
        .filter(
          (entry): entry is readonly [string, Record<string, unknown>] =>
            entry[0] !== undefined,
        ),
    );
    this.databaseLicenseActionById = new Map(
      (options.databaseLicenseActions ?? [])
        .map((action) => [valueAsString(action.id), action] as const)
        .filter(
          (entry): entry is readonly [string, Record<string, unknown>] =>
            entry[0] !== undefined,
        ),
    );
    this.persistSourceNameToCanonicalIdsFn =
      options.persistSourceNameToCanonicalIds;
    this.locations = new LocationDataContext(this);
    this.locationPaths = new LocationPathDataContext(this);
  }

  toImportRows(): ImportRows {
    return this.importRows;
  }

  validatePreparedRows(): string[] {
    return this.locationPaths.validatePreparedRows();
  }

  toImportOperations(): ImportOperations {
    return this.operations;
  }

  setOperation(
    entityType: ImportEntityType | "locationPath",
    rowId: string,
    operation: ImportOperation,
  ): void {
    if (entityType === "locationPath") {
      this.operations.locationPaths[rowId] = operation;
      return;
    }

    if (entityType === "agency") {
      this.operations.agencies[rowId] = operation;
      return;
    }

    this.operations.agencyOfficers[rowId] = operation;
  }

  async add<EntityType extends ImportEntityType>(
    entityType: EntityType,
    row: ImportEntityRow[EntityType],
  ): Promise<void> {
    if (entityType === "agency") {
      await this.addAgency(row as AgencyRow);
      return;
    }

    const resolver = this.entityResolvers?.[entityType] as
      | ImportEntityResolver<EntityType>
      | undefined;
    if (resolver === undefined) {
      throw new Error(`Unsupported import entity type ${entityType}.`);
    }

    await resolver(row, this);
  }

  private applyAgencyResolvedPropertyUpdates(
    updates: readonly AgencyResolvedPropertyUpdate[],
  ): void {
    if (this.resolvedProperties === undefined) {
      return;
    }

    for (const update of updates) {
      this.resolvedProperties.agencies[update.rowId] ??= {};
      Object.assign(
        this.resolvedProperties.agencies[update.rowId],
        update.mutation,
      );
    }
  }

  private async addAgency(agency: AgencyRow): Promise<void> {
    const existingAgency = this.databaseAgencyById.get(agency.id);
    if (existingAgency !== undefined) {
      return;
    }

    const adapters = {
      getLocationPathById: (locationPathId: string) =>
        this.locationPaths.getById(locationPathId),
      resolveAddress: (input: ResolveAddressInput) =>
        this.locations.resolveAddress(input),
    };

    try {
      const resolvedPropertyUpdates = await resolveCachedAgencyLocationPath(
        agency,
        adapters,
      );
      this.applyAgencyResolvedPropertyUpdates(resolvedPropertyUpdates);
    } catch (error) {
      agency.location_path_id = undefined;
      this.logger?.debug?.(
        {
          tableName: "public.agency",
          entityType: "agency",
          rowId: agency.id,
          locationPathId: agency.location_path_id,
          error: errorMessage(error),
        },
        "Cached import location path validation failed.",
      );
      throw error;
    }

    const missingColumns = missingResolvableAgencyFields(agency);
    if (missingColumns.length === 0) {
      return;
    }

    try {
      const resolution = await resolveAgencyMissingFields(
        agency,
        missingColumns,
        {
          adapters,
          agencyRows: this.toImportRows().agencies,
        },
        this.agencyFieldResolutionOptions ?? {},
      );
      this.applyAgencyResolvedPropertyUpdates(
        resolution.resolvedPropertyUpdates,
      );
      this.toImportRows().preparationMutations.push(
        ...resolution.preparationMutations,
      );
    } catch (error) {
      if (error instanceof AgencyFieldResolutionError) {
        this.applyAgencyResolvedPropertyUpdates(
          error.result.resolvedPropertyUpdates,
        );
        this.toImportRows().preparationMutations.push(
          ...error.result.preparationMutations,
        );
      }
      this.logger?.debug?.(
        {
          tableName: "public.agency",
          entityType: "agency",
          rowId: agency.id,
          missingFields: missingColumns,
          error: errorMessage(error),
        },
        "Agency field resolution failed.",
      );
      throw error;
    }
  }

  fromSource(input: SourceRecordContext): AgencyFacade {
    validateSourceRecordContext(input);
    const key = [input.apiVersion, input.namespace, "Agency", input.name].join(
      ":",
    );
    const existing = this.agencyFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) {
        existing.merge(input.spec);
      }
      return existing;
    }
    const facade = new AgencyFacade({
      current: input.current,
      source: {
        namespace: input.namespace,
        name: input.name,
        commandName: input.commandName ?? this.commandName,
      },
      backend: this.agencyResolverBackend(),
    });
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.agencyFacades.set(key, facade);
    return facade;
  }

  private agencyResolverBackend(): AgencyResolverBackend {
    return {
      findOrCreateCanonicalId: (input) =>
        this.findOrCreateAgencyCanonicalId(input),
      getCurrentById: (id) => this.databaseAgencyById.get(id),
      ensureUniqueAgencySlug: (input) =>
        this.ensureUniqueSlug("public.agency", input),
      registerAgencySlug: (input) => {
        this.registerSlug("public.agency", input.slug, input.canonicalId);
      },
      resolveAgencyLocation: (input) => this.locations.resolveAddress(input),
    };
  }

  private async findOrCreateAgencyCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string> {
    // Find a seeded/existing id before minting (ID stability).
    const existing = valueAsString(
      this.sourceNameToCanonicalIds?.agencies?.[input.sourceId]?.canonicalId,
    );
    if (existing !== undefined) {
      return existing;
    }

    const canonicalId = createId();
    if (this.sourceNameToCanonicalIds === undefined) {
      return canonicalId;
    }
    this.sourceNameToCanonicalIds.agencies[input.sourceId] = {
      kind: "Agency",
      canonicalId,
    };
    await this.persistSourceNameToCanonicalIdsFn?.(
      input.namespace,
      this.sourceNameToCanonicalIds,
    );
    return canonicalId;
  }

  mergeAgencyArtifacts(artifacts: ArtifactsEnvelope): void {
    const preparedAgencyBySourceName = new Map(
      this.importRows.agencies.map((agency) => [
        agency.sourceName ?? agency.id,
        agency,
      ]),
    );

    for (const artifact of artifacts.spec.artifacts.filter(
      (item) => item.kind === "Agencies",
    )) {
      for (const [recordName, record] of Object.entries(
        artifact.spec.records,
      )) {
        const sourceName = sourceNameForImportRecord(recordName, record);
        const agency = preparedAgencyBySourceName.get(sourceName);
        if (agency === undefined) {
          // The agency was skipped upstream (unresolvable coordinates or
          // location_path) and already reported via a per-agency warning, so
          // there is no prepared row to merge into the DatabaseMutations
          // envelope. Skip it rather than failing the whole import.
          continue;
        }

        this.fromSource({
          apiVersion: INTAKE_API_VERSION,
          namespace: artifacts.metadata.namespace,
          name: sourceName,
          spec: valueAsRecord(record),
        }).merge(preparedAgencySpec(agency));
      }
    }
  }

  personnelFromSource(input: SourceRecordContext): PersonnelFacade {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "Personnel",
      input.name,
    ].join(":");
    const existing = this.personnelFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) {
        existing.merge(input.spec);
      }
      return existing;
    }
    const facade = new PersonnelFacade({
      current: input.current,
      source: {
        namespace: input.namespace,
        name: input.name,
        commandName: input.commandName ?? this.commandName,
      },
      backend: this.personnelResolverBackend(),
    });
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.personnelFacades.set(key, facade);
    return facade;
  }

  private personnelResolverBackend(): PersonnelResolverBackend {
    return {
      findOrCreateCanonicalId: (input) =>
        this.findOrCreatePersonnelCanonicalId(input),
      getCurrentById: (id) => this.databaseOfficerById.get(id),
      ensureUniquePersonnelSlug: (input) =>
        this.ensureUniqueSlug("public.officers", input),
      registerPersonnelSlug: (input) => {
        this.registerSlug("public.officers", input.slug, input.canonicalId);
      },
    };
  }

  private async findOrCreatePersonnelCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string> {
    // Find in the ledger by (namespace, kind, source-id); mint + persist when
    // absent. ID stability: a seeded/existing id is always found before minting.
    const existing = valueAsString(
      this.sourceNameToCanonicalIds?.personnel?.[input.sourceId]?.canonicalId,
    );
    if (existing !== undefined) {
      return existing;
    }

    const canonicalId = createId();
    if (this.sourceNameToCanonicalIds === undefined) {
      return canonicalId;
    }
    this.sourceNameToCanonicalIds.personnel[input.sourceId] = {
      kind: "Personnel",
      canonicalId,
    };
    await this.persistSourceNameToCanonicalIdsFn?.(
      input.namespace,
      this.sourceNameToCanonicalIds,
    );
    return canonicalId;
  }

  private slugClaimsFor(table: SlugTableName): Map<string, string> {
    let claims = this.slugClaimsByTable.get(table);
    if (claims === undefined) {
      claims = new Map();
      this.slugClaimsByTable.set(table, claims);
    }
    return claims;
  }

  private slugDatabaseOwnerFor(
    table: SlugTableName,
  ): Map<string, string | null> {
    let owners = this.slugDatabaseOwnerByTable.get(table);
    if (owners === undefined) {
      owners = new Map();
      this.slugDatabaseOwnerByTable.set(table, owners);
    }
    return owners;
  }

  /** Register a resolved slug so a later generated slug disambiguates from it. */
  private registerSlug(
    table: SlugTableName,
    slug: string,
    canonicalId: string,
  ): void {
    this.slugClaimsFor(table).set(slug, canonicalId);
  }

  /**
   * Generate a slug unique across the three resolution levels for `table`: the
   * current command (in-memory claims), intake-owned state, and the database —
   * appending a numeric suffix until free, then registering the claim. Because a
   * durably-resolved slug is persisted to the database on import, the database
   * read is the durable authority for the state level.
   */
  private async ensureUniqueSlug(
    table: SlugTableName,
    input: { base: string; canonicalId: string },
  ): Promise<string> {
    const claims = this.slugClaimsFor(table);
    for (let attempt = 1; ; attempt += 1) {
      const candidate =
        attempt === 1 ? input.base : `${input.base}-${attempt}`;
      const claimant = claims.get(candidate);
      if (claimant !== undefined) {
        if (claimant === input.canonicalId) {
          return candidate;
        }
        continue;
      }
      const databaseOwner = await this.slugDatabaseOwnerId(table, candidate);
      if (databaseOwner !== undefined && databaseOwner !== input.canonicalId) {
        continue;
      }
      claims.set(candidate, input.canonicalId);
      return candidate;
    }
  }

  private async slugDatabaseOwnerId(
    table: SlugTableName,
    slug: string,
  ): Promise<string | undefined> {
    if (this.client === undefined) {
      return undefined;
    }
    const owners = this.slugDatabaseOwnerFor(table);
    const cached = owners.get(slug);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    const rows = await readDatabaseRecordsBySlugs(
      this.databaseClient(),
      table,
      [slug],
    );
    const owner = rows
      .map((row) => valueAsString(row.id))
      .find((id): id is string => id !== undefined);
    owners.set(slug, owner ?? null);
    return owner;
  }

  agencyPersonnelFromSource(input: SourceRecordContext): AgencyPersonnelFacade {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "AgencyPersonnel",
      input.name,
    ].join(":");
    const existing = this.agencyPersonnelFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) {
        existing.facade.merge(input.spec);
      }
      return existing.facade;
    }
    const canonicalId =
      input.canonicalId ??
      this.sourceNameToCanonicalIds?.agencyPersonnel[input.name]?.canonicalId;
    const facade = new AgencyPersonnelFacade(input.current);
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.agencyPersonnelFacades.set(key, {
      facade,
      source: {
        namespace: input.namespace,
        name: input.name,
        canonicalId,
        commandName: input.commandName ?? this.commandName,
      },
    });
    return facade;
  }

  licensingAuthorityFromSource(
    input: SourceRecordContext,
  ): LicensingAuthorityFacade {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "LicensingAuthority",
      input.name,
    ].join(":");
    const existing = this.licensingAuthorityFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) {
        existing.merge(input.spec);
      }
      return existing;
    }
    const facade = new LicensingAuthorityFacade({
      // Current-row loading (create-vs-update against an existing DB row) is
      // deferred: `licensing_authority` is a new table with no legacy rows
      // (ADR 0016 #8). The canonical id is still stable via the ledger resolver.
      current: input.current,
      source: {
        namespace: input.namespace,
        name: input.name,
        commandName: input.commandName ?? this.commandName,
      },
      backend: this.licensingAuthorityResolverBackend(),
    });
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.licensingAuthorityFacades.set(key, facade);
    return facade;
  }

  private licensingAuthorityResolverBackend(): LicensingAuthorityResolverBackend {
    return {
      getLocationPathByPath: (path) => this.locationPaths.getByPath(path),
      findOrCreateCanonicalId: (input) =>
        this.findOrCreateLicensingAuthorityCanonicalId(input),
      getCurrentById: (id) => this.databaseLicensingAuthorityById.get(id),
    };
  }

  private async findOrCreateLicensingAuthorityCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string> {
    // Find in the ledger by (namespace, kind, source-id).
    const existing = valueAsString(
      this.sourceNameToCanonicalIds?.licensingAuthorities?.[input.sourceId]
        ?.canonicalId,
    );
    if (existing !== undefined) {
      return existing;
    }

    // Create: mint a stable cuid2, record it in the ledger, and durably persist
    // it — the resolver is the sole owner of LicensingAuthority identity
    // (ADR 0016 #4), so it must not depend on any earlier minting stage.
    // Extension point: a natural-key match against the database would recover an
    // existing row's id before minting — deferred while `licensing_authority` is
    // a new table with no legacy rows.
    const canonicalId = createId();
    if (this.sourceNameToCanonicalIds === undefined) {
      return canonicalId;
    }
    this.sourceNameToCanonicalIds.licensingAuthorities ??= {};
    this.sourceNameToCanonicalIds.licensingAuthorities[input.sourceId] = {
      kind: "LicensingAuthority",
      canonicalId,
    };
    await this.persistSourceNameToCanonicalIdsFn?.(
      input.namespace,
      this.sourceNameToCanonicalIds,
    );
    return canonicalId;
  }

  licenseFromSource(input: SourceRecordContext): LicenseFacade {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "License",
      input.name,
    ].join(":");
    const existing = this.licenseFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) {
        existing.merge(input.spec);
      }
      return existing;
    }
    const facade = new LicenseFacade({
      current: input.current,
      source: {
        namespace: input.namespace,
        name: input.name,
        commandName: input.commandName ?? this.commandName,
      },
      backend: this.licenseResolverBackend(this.databaseLicenseById),
    });
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.licenseFacades.set(key, facade);
    return facade;
  }

  licenseActionFromSource(input: SourceRecordContext): LicenseActionFacade {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "LicenseAction",
      input.name,
    ].join(":");
    const existing = this.licenseActionFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) {
        existing.merge(input.spec);
      }
      return existing;
    }
    const facade = new LicenseActionFacade({
      current: input.current,
      source: {
        namespace: input.namespace,
        name: input.name,
        commandName: input.commandName ?? this.commandName,
      },
      backend: this.licenseResolverBackend(this.databaseLicenseActionById),
    });
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.licenseActionFacades.set(key, facade);
    return facade;
  }

  private licenseResolverBackend(
    databaseCurrentById: Map<string, Record<string, unknown>>,
  ): LicenseResolverBackend {
    return {
      findOrCreateCanonicalId: (input) =>
        this.findOrCreateLicenseCanonicalId(input),
      getCurrentById: (id) => databaseCurrentById.get(id),
      findForeignKeyTarget: (input) => this.findForeignKeyTarget(input),
    };
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
    if (input.kind === "Personnel") {
      // Await the Personnel facade's own id resolver (find-or-create), so the
      // referrer resolves against the same canonical id the facade emits.
      return this.personnelFacades.get(key);
    }
    if (input.kind === "LicensingAuthority") {
      return this.licensingAuthorityFacades.get(key);
    }
    if (input.kind === "License") {
      return this.licenseFacades.get(key);
    }
    return undefined;
  }

  private async findOrCreateLicenseCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string> {
    // Find in the ledger by (namespace, kind, source-id); mint + persist when
    // absent. The facade is the sole owner of License / LicenseAction identity
    // (ADR 0016 #4), so it must not depend on any earlier minting stage.
    const ledger =
      input.kind === "License"
        ? this.sourceNameToCanonicalIds?.licenses
        : this.sourceNameToCanonicalIds?.licenseActions;
    const existing = valueAsString(ledger?.[input.sourceId]?.canonicalId);
    if (existing !== undefined) {
      return existing;
    }

    const canonicalId = createId();
    if (this.sourceNameToCanonicalIds === undefined) {
      return canonicalId;
    }
    if (input.kind === "License") {
      this.sourceNameToCanonicalIds.licenses ??= {};
      this.sourceNameToCanonicalIds.licenses[input.sourceId] = {
        kind: "License",
        canonicalId,
      };
    } else {
      this.sourceNameToCanonicalIds.licenseActions ??= {};
      this.sourceNameToCanonicalIds.licenseActions[input.sourceId] = {
        kind: "LicenseAction",
        canonicalId,
      };
    }
    await this.persistSourceNameToCanonicalIdsFn?.(
      input.namespace,
      this.sourceNameToCanonicalIds,
    );
    return canonicalId;
  }

  async toMutations(): Promise<
    (
      | AgencyCreateEnvelope
      | AgencyUpdateEnvelope
      | PersonnelCreateEnvelope
      | PersonnelUpdateEnvelope
      | AgencyPersonnelCreateEnvelope
      | AgencyPersonnelUpdateEnvelope
      | LicensingAuthorityCreateEnvelope
      | LicensingAuthorityUpdateEnvelope
      | LicenseCreateEnvelope
      | LicenseUpdateEnvelope
      | LicenseActionCreateEnvelope
      | LicenseActionUpdateEnvelope
    )[]
  > {
    // Resolve facade mutations in dependency order so every same-source FK find
    // (ADR 0016 #4/#9) targets an already-emitted facade: LicensingAuthorities,
    // then Licenses (find Personnel + LicensingAuthority), then LicenseActions
    // (find License).
    const licensingAuthorities = await Promise.all(
      [...this.licensingAuthorityFacades.values()].map((facade) =>
        facade.toMutation(),
      ),
    );
    const licenses = await Promise.all(
      [...this.licenseFacades.values()].map((facade) => facade.toMutation()),
    );
    const licenseActions = await Promise.all(
      [...this.licenseActionFacades.values()].map((facade) =>
        facade.toMutation(),
      ),
    );
    // Personnel are resolver-based (ADR 0016): resolve them before Licenses so a
    // License officer-FK find (which awaits the Personnel facade's id) targets an
    // already-registered facade. Id resolution is idempotent/memoized, so order
    // only matters for registration, not correctness.
    const personnel = await Promise.all(
      [...this.personnelFacades.values()].map((facade) => facade.toMutation()),
    );
    const agencies = await Promise.all(
      [...this.agencyFacades.values()].map((facade) => facade.toMutation()),
    );
    return [
      ...agencies,
      ...personnel,
      ...[...this.agencyPersonnelFacades.values()].map(({ facade, source }) =>
        facade.toMutation(source),
      ),
      ...licensingAuthorities,
      ...licenses,
      ...licenseActions,
    ];
  }

  async toDatabaseMutationItems(): Promise<DatabaseMutationItem[]> {
    const ownedColumns = ownedColumnsMetadata(this.importRows);
    const facadeMutations = (await this.toMutations()).map((mutation) => ({
      kind: mutation.kind,
      name: mutation.metadata.name,
      spec: mutation.spec,
    }));
    const facadeAgencyPersonnelIds = new Set(
      [...this.agencyPersonnelFacades.values()]
        .map((entry) => valueAsString(entry.source.canonicalId))
        .filter((id): id is string => id !== undefined),
    );

    return [
      ...this.importRows.locationPaths.map((record) => ({
        kind: mutationKind(
          this.operations.locationPaths[record.location_path_id],
          "LocationPath",
        ),
        name: record.location_path_id,
        spec: databaseMutationSpec(
          this.operations.locationPaths[record.location_path_id],
          record,
        ),
      })),
      ...(this.importRows.locationPathGeometries ?? []).map((record) => ({
        kind: mutationKind(
          this.operations.locationPathGeometries[record.location_path_id],
          "LocationPathGeometry",
        ),
        name: record.location_path_id,
        spec: databaseMutationSpec(
          this.operations.locationPathGeometries[record.location_path_id],
          record,
        ),
      })),
      ...this.importRows.locationPathAliases.map((record) => ({
        kind: mutationKind(
          this.operations.locationPathAliases[record.alias_path],
          "LocationPathAlias",
        ),
        name: record.alias_path,
        spec: databaseMutationSpec(
          this.operations.locationPathAliases[record.alias_path],
          record,
        ),
      })),
      ...facadeMutations,
      // Agency and Personnel mutations are emitted by their facades via
      // `facadeMutations` (ADR 0016); there are no transform rows to assemble.
      // AgencyRow is retained only as the planning-pass resolution input
      // (coexistence), not for emission.
      ...this.importRows.agencyOfficers
        .filter((record) => !facadeAgencyPersonnelIds.has(record.id))
        .map((record) => {
          const recordOwnedColumnNames = recordOwnedColumns(
            this.importRows.ownedColumns.agencyOfficers[record.id] ?? [],
            ownedColumns.agencyPersonnel,
          );
          return {
            kind: mutationKind(
              this.operations.agencyOfficers[record.id],
              "AgencyPersonnel",
            ),
            name: record.id,
            spec: databaseSpec(record),
            ...(recordOwnedColumnNames === undefined
              ? {}
              : { ownedColumns: recordOwnedColumnNames }),
          };
        }),
      // License and LicenseAction mutations are emitted by their facades via
      // `facadeMutations` (ADR 0016); there are no transform rows to assemble.
    ];
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

  // `canonicalIdFromProperty` (ADR 0011) is superseded by the AgencyFacade
  // `location_path_id` composition resolver (ADR 0016 #7).

  async resolveLocationAdministrativeArea(
    input: LocationAdministrativeAreaRequest,
  ): Promise<LocationAdministrativeAreaResolution | undefined> {
    return this.resolveAdministrativeArea?.(input);
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

  async loadLocationPathStateById(
    locationPathId: string,
  ): Promise<LocationPathRow | undefined> {
    return this.loadLocationPathById?.(locationPathId);
  }

  async loadLocationPathStateByPath(
    locationPathPath: string,
  ): Promise<LocationPathRow | undefined> {
    return this.loadLocationPathByPath?.(locationPathPath);
  }

  getDatabaseLocationPathById(
    locationPathId: string,
  ): LocationPathRow | undefined {
    return this.databaseLocationPathById?.get(locationPathId);
  }

  getDatabaseLocationPathByPath(path: string): LocationPathRow | undefined {
    return this.databaseLocationPathByPath?.get(path);
  }

  getDatabaseLocationPathIdByAliasPath(aliasPath: string): string | undefined {
    return this.databaseLocationPathIdByAliasPath?.get(aliasPath);
  }

  hasDatabaseLocationPathSnapshot(): boolean {
    return this.databaseLocationPathsLoaded;
  }

  databaseClient(): DatabaseClient {
    if (this.client === undefined) {
      throw new Error("Database client is required for database reads.");
    }
    return this.client;
  }
}

function addressResolutionRequest(
  input: ResolveAddressInput,
): AddressResolutionRequest {
  const missingFields = [
    valueAsString(input.entityType) === undefined ? "entityType" : undefined,
    valueAsString(input.entityId) === undefined ? "entityId" : undefined,
    valueAsString(input.state) === undefined ? "state" : undefined,
    valueAsString(input.place) === undefined ? "place" : undefined,
    valueAsString(input.zipCode) === undefined ? "zipCode" : undefined,
    valueAsString(input.address) === undefined ? "address" : undefined,
  ].filter((fieldName): fieldName is string => fieldName !== undefined);

  if (missingFields.length > 0) {
    throw new Error(
      `Cannot resolve address for ${String(input.entityType)} ${String(input.entityId)} without ${missingFields.join(", ")}.`,
    );
  }

  return {
    entityType: input.entityType,
    entityId: input.entityId,
    ...(valueAsString(input.sourceName) === undefined
      ? {}
      : { sourceName: valueAsString(input.sourceName)! }),
    ...(valueAsString(input.name) === undefined
      ? {}
      : { name: valueAsString(input.name)! }),
    address: input.address!,
    place: input.place!,
    state: input.state!,
    zipCode: input.zipCode!,
    ...(valueAsString(input.administrativeAreaName) === undefined
      ? {}
      : {
          administrativeAreaName: valueAsString(input.administrativeAreaName)!,
        }),
    ...(valueAsString(input.administrativeAreaSlug) === undefined
      ? {}
      : {
          administrativeAreaSlug: valueAsString(input.administrativeAreaSlug)!,
        }),
    ...(Number.isFinite(input.latitude) ? { latitude: input.latitude } : {}),
    ...(Number.isFinite(input.longitude) ? { longitude: input.longitude } : {}),
  };
}

class LocationDataContext {
  constructor(private readonly context: DataContext) {}

  private async postalAreaLocationPathId(
    request: AddressResolutionRequest,
  ): Promise<string | undefined> {
    for (const path of postalAreaPlacePaths(request)) {
      const locationPath = await this.context.locationPaths.getByPath(path);
      if (locationPath !== undefined) {
        return locationPath.location_path_id;
      }
    }

    return undefined;
  }

  async resolveAddress(
    input: ResolveAddressInput,
  ): Promise<LocationResolution> {
    const request = addressResolutionRequest(input);
    const cached = this.context.getCachedLocation(
      request.entityType,
      request.entityId,
    );
    if (cached !== undefined) {
      return cached;
    }

    const addressResolution = await this.context.resolveAddress(request);
    if (addressResolution === undefined) {
      throw new Error(
        `Cannot resolve address for ${request.entityType} ${request.entityId}.`,
      );
    }

    let locationPathId: string;
    try {
      locationPathId = await this.context.locationPaths.getPlaceContainingPoint(
        {
          latitude: addressResolution.latitude,
          longitude: addressResolution.longitude,
          rowId: request.entityId,
        },
      );
    } catch (error) {
      if (!isMissingContainingPlaceError(error)) {
        throw error;
      }
      const postalLocationPathId = await this.postalAreaLocationPathId(request);
      if (postalLocationPathId === undefined) {
        throw error;
      }
      locationPathId = postalLocationPathId;
    }
    const resolution = {
      locationPathId,
      addressLatitude: addressResolution.latitude,
      addressLongitude: addressResolution.longitude,
    };
    this.context.cacheLocation(
      request.entityType,
      request.entityId,
      resolution,
    );
    return resolution;
  }
}

class LocationPathDataContext {
  constructor(private readonly context: DataContext) {}

  private preparedByPath(path: string): LocationPathRow | undefined {
    return this.context
      .toImportRows()
      .locationPaths.find((locationPath) => locationPath.path === path);
  }

  private preparedById(locationPathId: string): LocationPathRow | undefined {
    return this.context
      .toImportRows()
      .locationPaths.find(
        (locationPath) => locationPath.location_path_id === locationPathId,
      );
  }

  private async databaseByPath(
    path: string,
  ): Promise<LocationPathRow | undefined> {
    const cached = this.context.getDatabaseLocationPathByPath(path);
    if (cached !== undefined) {
      return cached;
    }
    if (this.context.hasDatabaseLocationPathSnapshot()) {
      return undefined;
    }

    return readLocationPathByPath(this.context.databaseClient(), path);
  }

  private async databaseById(
    locationPathId: string,
  ): Promise<LocationPathRow | undefined> {
    const cached = this.context.getDatabaseLocationPathById(locationPathId);
    if (cached !== undefined) {
      return cached;
    }
    if (this.context.hasDatabaseLocationPathSnapshot()) {
      return undefined;
    }

    return readLocationPathById(this.context.databaseClient(), locationPathId);
  }

  async getById(locationPathId: string): Promise<LocationPathRow | undefined> {
    const prepared = this.preparedById(locationPathId);
    if (prepared !== undefined) {
      return prepared;
    }

    const canonical =
      await this.context.loadLocationPathStateById(locationPathId);
    if (canonical !== undefined) {
      return canonical;
    }

    return this.databaseById(locationPathId);
  }

  async getByPath(path: string): Promise<LocationPathRow | undefined> {
    const prepared = this.preparedByPath(path);
    if (prepared !== undefined) {
      return prepared;
    }

    const canonical = await this.context.loadLocationPathStateByPath(path);
    if (canonical !== undefined) {
      return canonical;
    }

    return this.databaseByPath(path);
  }

  async getByAliasPath(
    aliasPath: string,
  ): Promise<LocationPathRow | undefined> {
    const preparedAlias = this.context
      .toImportRows()
      .locationPathAliases.find((alias) => alias.alias_path === aliasPath);
    const locationPathId =
      preparedAlias?.location_path_id ??
      this.context.getDatabaseLocationPathIdByAliasPath(aliasPath);
    if (locationPathId !== undefined) {
      return this.getById(locationPathId);
    }

    if (this.context.hasDatabaseLocationPathSnapshot()) {
      return undefined;
    }

    const alias = await readLocationPathAliasByPath(
      this.context.databaseClient(),
      aliasPath,
    );
    const aliasLocationPathId = valueAsString(alias?.location_path_id);
    return aliasLocationPathId === undefined
      ? undefined
      : this.getById(aliasLocationPathId);
  }

  async getPlaceContainingPoint(input: {
    latitude: number;
    longitude: number;
    rowId?: unknown;
  }): Promise<string> {
    // Prefer the most specific containing boundary: an incorporated place,
    // falling back to the containing county (administrative_area), falling
    // back to the state. Most Texas land is unincorporated, so many real
    // agencies (county constables, precincts, ISD police outside city
    // limits) only resolve at the county or state level.
    for (const level of CONTAINING_POINT_LEVELS) {
      const matches = await readLocationPathsContainingPoint(
        this.context.databaseClient(),
        { latitude: input.latitude, longitude: input.longitude, level },
      );
      if (matches.length === 0) {
        continue;
      }
      const uniqueMatches = [
        ...new Map(
          matches.map((locationPath) => [
            locationPath.location_path_id,
            locationPath,
          ]),
        ).values(),
      ];
      if (uniqueMatches.length > 1) {
        throw new Error(
          `Cannot resolve location_path_id for public.agency ${String(input.rowId)}; multiple ${level} location_path_geometry boundaries contain point ${input.latitude}, ${input.longitude}: ${uniqueMatches
            .map((locationPath) => locationPath.location_path_id)
            .sort()
            .join(", ")}.`,
        );
      }

      return uniqueMatches[0]!.location_path_id;
    }

    throw new Error(
      `Cannot resolve location_path_id for public.agency ${String(input.rowId)}; no place location_path_geometry boundary contains point ${input.latitude}, ${input.longitude}.`,
    );
  }

  validatePreparedRows(): string[] {
    const errors: string[] = [];
    const locationPathIdByPath = new Map<string, string>();

    for (const locationPath of this.context.toImportRows().locationPaths) {
      const malformed = malformedLocationPathMessage(locationPath);
      if (malformed.length > 0) {
        errors.push(malformed);
        continue;
      }

      const existingId = locationPathIdByPath.get(locationPath.path);
      if (
        existingId !== undefined &&
        existingId !== locationPath.location_path_id
      ) {
        errors.push(
          `Cannot prepare public.location_path ${locationPath.location_path_id}; path ${locationPath.path} already belongs to prepared location path ${existingId}.`,
        );
        continue;
      }

      locationPathIdByPath.set(
        locationPath.path,
        locationPath.location_path_id,
      );
    }

    return errors;
  }
}
