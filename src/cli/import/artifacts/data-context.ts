import { createId } from "@paralleldrive/cuid2";
import type { z } from "zod";
import {
  Resolver,
  facadeCanonicalIdResolver,
  facadeForeignKeyResolver,
  facadeNullableForeignKeyResolver,
  titleCaseResolver,
  titleCaseResolverNullable,
  nameCaseResolver,
  nameCaseResolverNullable,
  lowerCaseEmailResolverNullable,
  passthroughResolver,
  facadeStateLocationPathResolver,
  valueAsString,
  ResolvingFacade,
  type PropertyResolutionFacade,
  type PropertyCache,
  type ForeignKeyIdSource,
  type ResolverContext,
  type FacadeSource,
} from "./resolver-kit.js";
// Re-exported so existing importers of these symbols from ./data-context keep
// working while the generic kit lives in its own module.
export {
  Resolver,
  type PropertyResolutionFacade,
  type ForeignKeyIdSource,
  type ResolverContext,
};
import type {
  EntityFacade,
  EntityFacadeBackend,
} from "./facades/entity-facade.js";
import {
  createDisciplineFacade,
  type DisciplineRow,
  type DisciplineEnvelope,
} from "./facades/discipline.js";
import {
  createDisciplineAgencyOfficerFacade,
  type DisciplineAgencyOfficerRow,
  type DisciplineAgencyOfficerEnvelope,
} from "./facades/discipline-agency-officer.js";
import {
  createCoverageLinkFacade,
  type CoverageLinkRow,
  type CoverageLinkEnvelope,
} from "./facades/coverage-link.js";
import {
  createCoverageLinkAgencyOfficerFacade,
  type CoverageLinkAgencyOfficerRow,
  type CoverageLinkAgencyOfficerEnvelope,
} from "./facades/coverage-link-agency-officer.js";
import {
  createAgencyPhoneNumberFacade,
  type AgencyPhoneNumberRow,
  type AgencyPhoneNumberEnvelope,
} from "./facades/agency-phone-number.js";
import {
  createFederalAgencyFacade,
  type FederalAgencyRow,
  type FederalAgencyEnvelope,
} from "./facades/federal-agency.js";
import {
  createFederalAgencyBranchFacade,
  type FederalAgencyBranchRow,
  type FederalAgencyBranchEnvelope,
} from "./facades/federal-agency-branch.js";
import {
  createCivilCaseFacade,
  type CivilCaseRow,
  type CivilCaseEnvelope,
} from "./facades/civil-case.js";
import {
  createCivilCaseOfficerFacade,
  type CivilCaseOfficerRow,
  type CivilCaseOfficerEnvelope,
} from "./facades/civil-case-officer.js";
import {
  createCivilCaseLinkFacade,
  type CivilCaseLinkRow,
  type CivilCaseLinkEnvelope,
} from "./facades/civil-case-link.js";
import {
  LocationPathSpec,
  RECORD_KINDS_IN_DEPENDENCY_ORDER,
  RESOLVED_PROPERTIES,
  TABLE_BY_KIND,
} from "../../../shared/io/generated/entity-specs.js";
import { IMPORT_OPERATION_SUFFIXES } from "../../../shared/io/import-type-metadata.js";
import type { ArtifactsEnvelope } from "../../../shared/io/Artifacts.js";
import {
  INTAKE_API_VERSION,
  parseMutationKind,
  sourceNameForImportRecord,
} from "../../../shared/io/import-types.js";
import type { DatabaseClient } from "../../database/index.js";
import {
  readLocationPathAliasByPath,
  readLocationPathById,
  readLocationPathByPath,
  readLocationPathsContainingPoint,
} from "../../database/location-paths.js";
import { readDatabaseRecordsByColumn } from "../../database/entities.js";
import type { SupportedTableName } from "../../database/schema.js";

// The location_path row is the generated model (stays in sync with the schema).
type LocationPathRow = z.infer<typeof LocationPathSpec>;

/** Tables whose slug uniqueness the DataContext enforces (generate-unique). */
type SlugKind = "Personnel" | "Agency";
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
  LocationPathCreate,
  type LocationPathCreateEnvelope,
} from "./io/generated-mutations/LocationPathCreate.js";
import {
  LocationPathRead,
  type LocationPathReadEnvelope,
} from "./io/generated-mutations/LocationPathRead.js";
import {
  LocationPathAliasCreate,
  type LocationPathAliasCreateEnvelope,
} from "./io/generated-mutations/LocationPathAliasCreate.js";
import {
  LocationPathAliasRead,
  type LocationPathAliasReadEnvelope,
} from "./io/generated-mutations/LocationPathAliasRead.js";
import {
  LocationPathGeometryCreate,
  type LocationPathGeometryCreateEnvelope,
} from "./io/generated-mutations/LocationPathGeometryCreate.js";
import {
  LocationPathGeometryRead,
  type LocationPathGeometryReadEnvelope,
} from "./io/generated-mutations/LocationPathGeometryRead.js";
import {
  DatabaseMutations,
  type DatabaseMutationItem,
  type DatabaseMutationsEnvelope,
} from "./io/DatabaseMutations.js";
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
  resolveAdministrativeArea?: (
    input: LocationAdministrativeAreaRequest,
  ) => Promise<LocationAdministrativeAreaResolution | undefined>;
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

// AgencyPersonnelFacade is defined below alongside the other resolver-based
// facades (License / LicenseAction), after the resolver infrastructure.

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
   * The existing database row for a resolved canonical id, if any (a lazy
   * per-id read). Lets the facade decide create-vs-update automatically, so a
   * re-import emits an update, not a duplicate create.
   */
  existingRow(id: string): Promise<Record<string, unknown> | undefined>;
};

// PropertyResolutionFacade, ForeignKeyIdSource, and the Resolver class now live
// in ./resolver-kit.ts — imported and re-exported at the top of this file.

type LicensingAuthorityResolvers = Partial<{
  [K in keyof LicensingAuthorityRowShape]: Resolver<
    LicensingAuthorityRowShape[K],
    ResolverContext<
      LicensingAuthorityRowShape,
      LicensingAuthorityResolverBackend
    >
  >;
}>;

/** Canonical-id find-or-create resolver (ADR 0016 #4, "id" property). */
function licensingAuthorityCanonicalIdResolver(): Resolver<
  string,
  ResolverContext<LicensingAuthorityRowShape, LicensingAuthorityResolverBackend>
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

export class LicensingAuthorityFacade implements PropertyResolutionFacade<LicensingAuthorityRowShape> {
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
      location_path_id: facadeStateLocationPathResolver<
        LicensingAuthorityRowShape,
        LicensingAuthorityResolverBackend
      >("LicensingAuthority"),
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
    return (
      value === undefined ? null : value
    ) as LicensingAuthorityRowShape[K];
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
    const current = this.current ?? (await this.backend.existingRow(id));

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
  existingRow(id: string): Promise<Record<string, unknown> | undefined>;
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

export class LicenseFacade implements PropertyResolutionFacade<LicenseRowShape> {
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

    const current = this.current ?? (await this.backend.existingRow(id));

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

export class LicenseActionFacade implements PropertyResolutionFacade<LicenseActionRowShape> {
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

    const current = this.current ?? (await this.backend.existingRow(id));

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
  last_name: string | null;
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
  existingRow(id: string): Promise<Record<string, unknown> | undefined>;
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
      backend.registerPersonnelSlug({
        slug: explicit,
        canonicalId: explicitId,
      });
      return explicit;
    }
    // Stability: reuse the existing DB row's slug so a corrected name does not
    // change an officer's slug.
    const id = explicitId;
    const current = await backend.existingRow(id);
    const currentSlug =
      current === undefined ? undefined : valueAsString(current.slug);
    if (currentSlug !== undefined) {
      backend.registerPersonnelSlug({ slug: currentSlug, canonicalId: id });
      return currentSlug;
    }
    // Generate: derive a base from name + canonical-id suffix, then disambiguate
    // for uniqueness across all three levels.
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
    const base = `${slugify(fullName)}-${canonicalSuffix(id)}`;
    return backend.ensureUniquePersonnelSlug({ base, canonicalId: id });
  });
}

type PersonnelResolvers = Partial<{
  [K in keyof PersonnelRowShape]: Resolver<
    PersonnelRowShape[K],
    ResolverContext<PersonnelRowShape, PersonnelResolverBackend>
  >;
}>;

export class PersonnelFacade implements PropertyResolutionFacade<PersonnelRowShape> {
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
      id: facadeCanonicalIdResolver<
        PersonnelRowShape,
        PersonnelResolverBackend
      >(PersonnelFacade.kind),
      slug: personnelSlugResolver(),
      // Casing normalization for ALL-CAPS source names (applied via resolvers so
      // slugs, which read `facade.raw`, are unaffected). `first_name` is required;
      // `last_name`/`middle_name`/`prefix`/`suffix` are nullable columns.
      first_name: nameCaseResolver<PersonnelRowShape, PersonnelResolverBackend>(
        "first_name",
      ),
      last_name: nameCaseResolverNullable<
        PersonnelRowShape,
        PersonnelResolverBackend
      >("last_name"),
      middle_name: nameCaseResolverNullable<
        PersonnelRowShape,
        PersonnelResolverBackend
      >("middle_name"),
      prefix: nameCaseResolverNullable<
        PersonnelRowShape,
        PersonnelResolverBackend
      >("prefix"),
      suffix: nameCaseResolverNullable<
        PersonnelRowShape,
        PersonnelResolverBackend
      >("suffix"),
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

    const current = this.current ?? (await this.backend.existingRow(id));

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

/** The database row shape an `AgencyFacade` resolves toward (public.agency). */
export type AgencyRowShape = {
  id: string;
  name: string;
  city: string;
  state: string;
  address: string;
  zip_code: string;
  contact_name: string | null;
  contact_email: string | null;
  slug: string;
  location_path_id: string;
  latitude: number;
  longitude: number;
  // Envelope-only geocoding hint (administrative-area name/slug); not a column.
  location?: Record<string, unknown>;
};

/** Backend capabilities the Agency resolvers reach through. */
export type AgencyResolverBackend = {
  findOrCreateCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string>;
  existingRow(id: string): Promise<Record<string, unknown> | undefined>;
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
  resolveAgencyLocation(
    input: ResolveAddressInput,
  ): Promise<LocationResolution>;
};

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
    const current = await backend.existingRow(id);
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

export class AgencyFacade extends ResolvingFacade<
  AgencyRowShape,
  AgencyResolverBackend
> {
  private static readonly kind = "Agency";
  private readonly current?: Record<string, unknown>;

  protected readonly resolvers: AgencyResolvers = {
    id: facadeCanonicalIdResolver<AgencyRowShape, AgencyResolverBackend>(
      AgencyFacade.kind,
    ),
    slug: agencySlugResolver(),
    // Casing normalization for ALL-CAPS source data (applied via resolvers so
    // slugs, which read `facade.raw`, are unaffected). `name` is required;
    // `city`/`address`/`contact_name`/`contact_email` are nullable columns.
    name: titleCaseResolver<AgencyRowShape, AgencyResolverBackend>("name"),
    // `address`/`city`/`zip_code` are optional in the artifact but required in
    // the *Create mutation (`RESOLVED_PROPERTIES.Agency`): a source that omits
    // one is supplied from the property cache (a committed seed) — which then
    // feeds the coordinate + location-path resolvers below via `facade.value`;
    // with neither source nor seed, the required resolver fails loud at the
    // mutation boundary. Which properties are cached is derived from
    // `RESOLVED_PROPERTIES`, not marked here. `state`/`zip_code` pass through
    // uncased (a code, not prose); `state` is always source-provided.
    city: titleCaseResolver<AgencyRowShape, AgencyResolverBackend>("city"),
    state: passthroughResolver<AgencyRowShape, AgencyResolverBackend>("state"),
    address: titleCaseResolver<AgencyRowShape, AgencyResolverBackend>(
      "address",
    ),
    zip_code: passthroughResolver<AgencyRowShape, AgencyResolverBackend>(
      "zip_code",
    ),
    contact_name: nameCaseResolverNullable<
      AgencyRowShape,
      AgencyResolverBackend
    >("contact_name"),
    contact_email: lowerCaseEmailResolverNullable<
      AgencyRowShape,
      AgencyResolverBackend
    >("contact_email"),
    location_path_id: agencyLocationPathResolver(),
    latitude: agencyCoordinateResolver("addressLatitude", "latitude"),
    longitude: agencyCoordinateResolver("addressLongitude", "longitude"),
  };

  constructor(options: {
    current?: Record<string, unknown>;
    source: FacadeSource;
    backend: AgencyResolverBackend;
    cache?: PropertyCache;
  }) {
    super(
      AgencyFacade.kind,
      options.source,
      options.backend,
      options.cache,
      RESOLVED_PROPERTIES[AgencyFacade.kind],
    );
    this.current = options.current;
  }

  protected canonicalId(): Promise<string> {
    return this.value("id");
  }

  /** Present pass-through metadata columns (omitted when absent, never null). */
  async toMutation(): Promise<AgencyCreateEnvelope | AgencyUpdateEnvelope> {
    const id = await this.value("id");
    const desired: Record<string, unknown> = {};
    for (const column of AGENCY_SCALAR_COLUMNS) {
      desired[column] = await this.value(column);
    }

    const current = this.current ?? (await this.backend.existingRow(id));

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

// --- AgencyPersonnel facade (ADR 0016) ---------------------------------------
//
// AgencyPersonnel (agency_officers) is a pure foreign-key entity: `id` is a
// canonical-id find-or-create; `agency_id` / `personnel_id` find the Agency /
// Personnel facades; `license_id` finds the License facade but is nullable (a
// null source reference stays null). Each FK is a same-source FIND that awaits
// the target facade's id and fails loud on a forward reference (ADR 0016 #4/#9).
// The remaining columns are plain.

/** The database row shape an `AgencyPersonnelFacade` resolves toward. */
export type AgencyOfficerRowShape = {
  id: string;
  agency_id: string;
  officer_id: string;
  badge_number: string | null;
  start_date: string;
  end_date: string | null;
  title: string;
  license_id: string | null;
};

type AgencyPersonnelResolvers = Partial<{
  [K in keyof AgencyOfficerRowShape]: Resolver<
    AgencyOfficerRowShape[K],
    ResolverContext<AgencyOfficerRowShape, LicenseResolverBackend>
  >;
}>;

export class AgencyPersonnelFacade implements PropertyResolutionFacade<AgencyOfficerRowShape> {
  private static readonly kind = "AgencyPersonnel";
  private readonly current?: Record<string, unknown>;
  private readonly spec: Record<string, unknown> = {};
  private readonly source: FacadeSource;
  private readonly backend: LicenseResolverBackend;
  private readonly resolvers: AgencyPersonnelResolvers;
  private readonly memo = new Map<
    keyof AgencyOfficerRowShape,
    Promise<unknown>
  >();
  private readonly inProgress = new Set<keyof AgencyOfficerRowShape>();

  constructor(options: {
    current?: Record<string, unknown>;
    source: FacadeSource;
    backend: LicenseResolverBackend;
  }) {
    this.current = options.current;
    this.source = options.source;
    this.backend = options.backend;
    this.resolvers = {
      id: facadeCanonicalIdResolver<AgencyOfficerRowShape>(
        AgencyPersonnelFacade.kind,
      ),
      agency_id: facadeForeignKeyResolver<AgencyOfficerRowShape>(
        AgencyPersonnelFacade.kind,
        "agency_id",
        "Agency",
      ),
      // officer_id is the agency_officers column; the FK still targets Personnel.
      officer_id: facadeForeignKeyResolver<AgencyOfficerRowShape>(
        AgencyPersonnelFacade.kind,
        "officer_id",
        "Personnel",
      ),
      license_id: facadeNullableForeignKeyResolver<AgencyOfficerRowShape>(
        AgencyPersonnelFacade.kind,
        "license_id",
        "License",
      ),
    };
  }

  merge(spec: Record<string, unknown>): void {
    Object.assign(this.spec, spec);
  }

  raw(property: keyof AgencyOfficerRowShape): unknown {
    return this.spec[property as string];
  }

  value<K extends keyof AgencyOfficerRowShape>(
    property: K,
  ): Promise<AgencyOfficerRowShape[K]> {
    const cached = this.memo.get(property);
    if (cached !== undefined) {
      return cached as Promise<AgencyOfficerRowShape[K]>;
    }
    const pending = this.computeValue(property);
    this.memo.set(property, pending);
    return pending;
  }

  private async computeValue<K extends keyof AgencyOfficerRowShape>(
    property: K,
  ): Promise<AgencyOfficerRowShape[K]> {
    if (this.inProgress.has(property)) {
      throw new Error(
        `Circular property dependency while resolving ${AgencyPersonnelFacade.kind}.${String(
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

  private plainValue<K extends keyof AgencyOfficerRowShape>(
    property: K,
  ): AgencyOfficerRowShape[K] {
    const value = this.spec[property as string];
    return (value === undefined ? null : value) as AgencyOfficerRowShape[K];
  }

  private unresolvedMessage(property: keyof AgencyOfficerRowShape): string {
    return `Cannot resolve ${AgencyPersonnelFacade.kind}.${String(
      property,
    )} for source ${this.source.namespace}/${this.source.name}; offending value ${JSON.stringify(
      this.spec[property as string],
    )}.`;
  }

  async toMutation(): Promise<
    AgencyPersonnelCreateEnvelope | AgencyPersonnelUpdateEnvelope
  > {
    const id = await this.value("id");
    const agencyId = await this.value("agency_id");
    const officerId = await this.value("officer_id");
    const badgeNumber = await this.value("badge_number");
    const startDate = await this.value("start_date");
    const endDate = await this.value("end_date");
    const title = await this.value("title");
    const licenseId = await this.value("license_id");

    const current = this.current ?? (await this.backend.existingRow(id));

    if (current === undefined) {
      return AgencyPersonnelCreate.new({
        metadata: {
          namespace: this.source.namespace,
          name: this.source.name,
        },
        spec: {
          id,
          agency_id: agencyId,
          officer_id: officerId,
          badge_number: badgeNumber,
          start_date: startDate,
          end_date: endDate,
          title,
          license_id: licenseId,
        } as Parameters<typeof AgencyPersonnelCreate.new>[0]["spec"],
      });
    }

    const commandName = valueAsString(this.source.commandName);
    if (commandName === undefined) {
      throw new Error(
        `Cannot create agency-personnel update for ${this.source.namespace}/${this.source.name} without command name.`,
      );
    }

    const source = {
      namespace: this.source.namespace,
      command: { name: commandName },
      kind: AgencyPersonnelFacade.kind,
      name: this.source.name,
    };
    const desired: Record<string, unknown> = {
      agency_id: agencyId,
      officer_id: officerId,
      badge_number: badgeNumber,
      start_date: startDate,
      end_date: endDate,
      title,
      license_id: licenseId,
    };
    const operations = Object.entries(desired).map(([path, to]) => {
      const from = current[path];
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
        namespace: this.source.namespace,
        name: this.source.name,
      },
      spec: { operations },
    });
  }
}

// --- Census substrate facades (ADR 0016) -------------------------------------
//
// LocationPath / LocationPathGeometry / LocationPathAlias are resolver-based
// facades. LocationPath's `location_path_id` is a canonical-id find-or-create
// (ID stability anchors everything) and `parent_location_path_id` is a nullable
// self-FK find of the parent LocationPath facade (null at the state root).
// Alias finds its target LocationPath facade. All emit Create/Read (never
// update) via `existingRow`.
//
// Registered in the write pass; the `LocationPathRow` transform rows survive only
// as location-resolver / id-stability-validation substrate. Geometries stream
// separately (`appendStreamingLocationPathGeometryMutations`).

/** The database row shape a `LocationPathFacade` resolves toward. */
export type LocationPathRowShape = {
  location_path_id: string;
  path: string;
  level: "state" | "administrative_area" | "place";
  state_or_territory_slug: string;
  administrative_area_slug: string | null;
  place_slug: string | null;
  state_or_territory_name: string;
  administrative_area_name: string | null;
  place_name: string | null;
  parent_location_path_id: string | null;
  centroid?: unknown;
  bbox?: unknown;
};

/** Canonical-id find-or-create resolver bound to a non-`id` identity column. */
function facadeIdentityColumnResolver<Row>(
  kind: string,
): Resolver<string, ResolverContext<Row, LicenseResolverBackend>> {
  return new Resolver(async ({ source, backend }) =>
    backend.findOrCreateCanonicalId({
      namespace: source.namespace,
      kind,
      sourceId: source.name,
    }),
  );
}

const LOCATION_PATH_COLUMNS = [
  "path",
  "level",
  "state_or_territory_slug",
  "administrative_area_slug",
  "place_slug",
  "state_or_territory_name",
  "administrative_area_name",
  "place_name",
  "parent_location_path_id",
  "centroid",
  "bbox",
] as const satisfies readonly (keyof LocationPathRowShape)[];

type LocationPathResolvers = Partial<{
  [K in keyof LocationPathRowShape]: Resolver<
    LocationPathRowShape[K],
    ResolverContext<LocationPathRowShape, LicenseResolverBackend>
  >;
}>;

export class LocationPathFacade implements PropertyResolutionFacade<LocationPathRowShape> {
  private static readonly kind = "LocationPath";
  private readonly current?: Record<string, unknown>;
  private readonly spec: Record<string, unknown> = {};
  private readonly source: FacadeSource;
  private readonly backend: LicenseResolverBackend;
  private readonly resolvers: LocationPathResolvers;
  private readonly memo = new Map<
    keyof LocationPathRowShape,
    Promise<unknown>
  >();
  private readonly inProgress = new Set<keyof LocationPathRowShape>();

  constructor(options: {
    current?: Record<string, unknown>;
    source: FacadeSource;
    backend: LicenseResolverBackend;
  }) {
    this.current = options.current;
    this.source = options.source;
    this.backend = options.backend;
    this.resolvers = {
      location_path_id: facadeIdentityColumnResolver<LocationPathRowShape>(
        LocationPathFacade.kind,
      ),
      parent_location_path_id:
        facadeNullableForeignKeyResolver<LocationPathRowShape>(
          LocationPathFacade.kind,
          "parent_location_path_id",
          "LocationPath",
        ),
    };
  }

  merge(spec: Record<string, unknown>): void {
    Object.assign(this.spec, spec);
  }

  raw(property: keyof LocationPathRowShape): unknown {
    return this.spec[property as string];
  }

  value<K extends keyof LocationPathRowShape>(
    property: K,
  ): Promise<LocationPathRowShape[K]> {
    const cached = this.memo.get(property);
    if (cached !== undefined) {
      return cached as Promise<LocationPathRowShape[K]>;
    }
    const pending = this.computeValue(property);
    this.memo.set(property, pending);
    return pending;
  }

  private async computeValue<K extends keyof LocationPathRowShape>(
    property: K,
  ): Promise<LocationPathRowShape[K]> {
    if (this.inProgress.has(property)) {
      throw new Error(
        `Circular property dependency while resolving ${LocationPathFacade.kind}.${String(
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

  private plainValue<K extends keyof LocationPathRowShape>(
    property: K,
  ): LocationPathRowShape[K] {
    const value = this.spec[property as string];
    return (value === undefined ? null : value) as LocationPathRowShape[K];
  }

  private unresolvedMessage(property: keyof LocationPathRowShape): string {
    return `Cannot resolve ${LocationPathFacade.kind}.${String(
      property,
    )} for source ${this.source.namespace}/${this.source.name}; offending value ${JSON.stringify(
      this.spec[property as string],
    )}.`;
  }

  async toMutation(): Promise<
    LocationPathCreateEnvelope | LocationPathReadEnvelope
  > {
    const locationPathId = await this.value("location_path_id");
    const columns: Record<string, unknown> = {};
    for (const column of LOCATION_PATH_COLUMNS) {
      const value = await this.value(column);
      if (value !== undefined && value !== null) {
        columns[column] = value;
      } else if (column !== "centroid" && column !== "bbox") {
        columns[column] = value;
      }
    }

    const current =
      this.current ?? (await this.backend.existingRow(locationPathId));
    if (current !== undefined) {
      // Read (never update): the census row already exists.
      return LocationPathRead.new({
        metadata: {
          namespace: this.source.namespace,
          name: locationPathId,
        },
        spec: {},
      });
    }

    return LocationPathCreate.new({
      metadata: {
        namespace: this.source.namespace,
        name: locationPathId,
      },
      spec: {
        location_path_id: locationPathId,
        ...columns,
      } as Parameters<typeof LocationPathCreate.new>[0]["spec"],
    });
  }
}

/** The database row shape a `LocationPathAliasFacade` resolves toward. */
export type LocationPathAliasRowShape = {
  alias_path: string;
  location_path_id: string;
};

type LocationPathAliasResolvers = Partial<{
  [K in keyof LocationPathAliasRowShape]: Resolver<
    LocationPathAliasRowShape[K],
    ResolverContext<LocationPathAliasRowShape, LicenseResolverBackend>
  >;
}>;

export class LocationPathAliasFacade implements PropertyResolutionFacade<LocationPathAliasRowShape> {
  private static readonly kind = "LocationPathAlias";
  private readonly current?: Record<string, unknown>;
  private readonly spec: Record<string, unknown> = {};
  private readonly source: FacadeSource;
  private readonly backend: LicenseResolverBackend;
  private readonly resolvers: LocationPathAliasResolvers;
  private readonly memo = new Map<
    keyof LocationPathAliasRowShape,
    Promise<unknown>
  >();
  private readonly inProgress = new Set<keyof LocationPathAliasRowShape>();

  constructor(options: {
    current?: Record<string, unknown>;
    source: FacadeSource;
    backend: LicenseResolverBackend;
  }) {
    this.current = options.current;
    this.source = options.source;
    this.backend = options.backend;
    this.resolvers = {
      // The alias's identity is its natural key `alias_path` (plain); only the
      // FK to the target LocationPath is resolved.
      location_path_id: facadeForeignKeyResolver<LocationPathAliasRowShape>(
        LocationPathAliasFacade.kind,
        "location_path_id",
        "LocationPath",
      ),
    };
  }

  merge(spec: Record<string, unknown>): void {
    Object.assign(this.spec, spec);
  }

  raw(property: keyof LocationPathAliasRowShape): unknown {
    return this.spec[property as string];
  }

  value<K extends keyof LocationPathAliasRowShape>(
    property: K,
  ): Promise<LocationPathAliasRowShape[K]> {
    const cached = this.memo.get(property);
    if (cached !== undefined) {
      return cached as Promise<LocationPathAliasRowShape[K]>;
    }
    const pending = this.computeValue(property);
    this.memo.set(property, pending);
    return pending;
  }

  private async computeValue<K extends keyof LocationPathAliasRowShape>(
    property: K,
  ): Promise<LocationPathAliasRowShape[K]> {
    if (this.inProgress.has(property)) {
      throw new Error(
        `Circular property dependency while resolving ${LocationPathAliasFacade.kind}.${String(
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

  private plainValue<K extends keyof LocationPathAliasRowShape>(
    property: K,
  ): LocationPathAliasRowShape[K] {
    const value = this.spec[property as string];
    return (value === undefined ? null : value) as LocationPathAliasRowShape[K];
  }

  private unresolvedMessage(property: keyof LocationPathAliasRowShape): string {
    return `Cannot resolve ${LocationPathAliasFacade.kind}.${String(
      property,
    )} for source ${this.source.namespace}/${this.source.name}; offending value ${JSON.stringify(
      this.spec[property as string],
    )}.`;
  }

  async toMutation(): Promise<
    LocationPathAliasCreateEnvelope | LocationPathAliasReadEnvelope
  > {
    const aliasPath = await this.value("alias_path");
    const locationPathId = await this.value("location_path_id");

    const current =
      this.current ?? (await this.backend.existingRow(aliasPath));
    if (current !== undefined) {
      return LocationPathAliasRead.new({
        metadata: { namespace: this.source.namespace, name: aliasPath },
        spec: {},
      });
    }

    return LocationPathAliasCreate.new({
      metadata: { namespace: this.source.namespace, name: aliasPath },
      spec: {
        alias_path: aliasPath,
        location_path_id: locationPathId,
      } as Parameters<typeof LocationPathAliasCreate.new>[0]["spec"],
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



/**
 * True when an item is an update whose operations are *all* `check` — it asserts
 * expected state but sets nothing, so it mutates nothing and is not a mutation
 * (ADR 0011/0014). These are dropped from the emitted plan so a re-import of an
 * already-matching row emits no SELECT + empty UPDATE; an update that still
 * carries a `set` keeps its sibling `check`s as per-row drift guards, and creates
 * (which have no `operations`) are never affected.
 */
const DEPENDENCY_ORDER_INDEX = new Map<string, number>(
  RECORD_KINDS_IN_DEPENDENCY_ORDER.map((recordKind, index) => [
    recordKind,
    index,
  ]),
);

/** The record kind of a mutation kind, stripping the operation suffix. */
function recordKindOfMutation(mutationKind: string): string {
  for (const suffix of Object.values(IMPORT_OPERATION_SUFFIXES)) {
    if (mutationKind.endsWith(suffix)) {
      return mutationKind.slice(0, -suffix.length);
    }
  }
  return mutationKind;
}

/**
 * Orders mutation items by database dependency, using the generated
 * `RECORD_KINDS_IN_DEPENDENCY_ORDER` (a topological sort of the introspected
 * foreign-key graph), so a referenced entity is applied before its referrer
 * (e.g. Licenses before the AgencyPersonnel whose `license_id` targets them). A
 * stable sort preserves the within-kind order. Unknown kinds sort last.
 */
// Order every create before any update (ADR 0020). Creates keep FK-dependency
// order among themselves (a row's FK targets are created first); updates follow
// all creates, so an update's FK to a row created this import already exists and
// an update never gates a create (its own target row already existed). The
// replay can then batch each contiguous create run and apply updates singly —
// the first update marks the end of the creates.
function sortByDependencyOrder(
  items: DatabaseMutationItem[],
): DatabaseMutationItem[] {
  const operationRank = (item: DatabaseMutationItem): number =>
    "kind" in item && parseMutationKind(item.kind).operation === "create"
      ? 0
      : 1;
  const dependencyIndex = (item: DatabaseMutationItem): number =>
    "kind" in item
      ? (DEPENDENCY_ORDER_INDEX.get(recordKindOfMutation(item.kind)) ??
        Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        operationRank(a.item) - operationRank(b.item) ||
        dependencyIndex(a.item) - dependencyIndex(b.item) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

function isCheckOnlyUpdateItem(item: DatabaseMutationItem): boolean {
  if (!("spec" in item)) {
    return false;
  }
  const operations = (item.spec as { operations?: unknown }).operations;
  return (
    Array.isArray(operations) &&
    operations.length > 0 &&
    operations.every(
      (operation) =>
        typeof operation === "object" &&
        operation !== null &&
        (operation as { action?: unknown }).action === "check",
    )
  );
}

function valueAsRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error("Artifacts agency record must be an object.");
}

type RowReadBatch = {
  tableName: SupportedTableName;
  identityColumn: string;
  requests: Map<
    string,
    {
      resolve: (row: Record<string, unknown> | undefined) => void;
      reject: (error: unknown) => void;
    }
  >;
};

export class DataContext {
  readonly locations: LocationDataContext;
  readonly locationPaths: LocationPathDataContext;
  private readonly client?: DatabaseClient;
  private readonly lazyCurrentRowCache = new Map<
    string,
    Promise<Record<string, unknown> | undefined>
  >();
  private readonly pendingRowReads = new Map<string, RowReadBatch>();
  private rowReadFlushScheduled = false;
  readonly logger?: DataContextLogger;
  private readonly addressResolutionCache = new Map<
    string,
    LocationResolution
  >();
  private readonly resolveAddressFn?: DataContextOptions["resolveAddress"];
  private readonly resolveAdministrativeArea?: DataContextOptions["resolveAdministrativeArea"];
  private readonly resolvedPropertyStore?: ResolvedPropertyStore;
  private readonly commandName?: string;
  private readonly ledger?: SourceNameToCanonicalIdLedger;
  /** per-table current-command slug → owning canonical id (uniqueness level 1). */
  private readonly slugClaimsByKind = new Map<
    SlugKind,
    Map<string, string>
  >();
  /** per-table memoized DB slug → owning id (null = unused), queried once. */
  private readonly slugDatabaseOwnerByKind = new Map<
    SlugKind,
    Map<string, string | null>
  >();
  private readonly agencyFacades = new Map<string, AgencyFacade>();
  private readonly personnelFacades = new Map<string, PersonnelFacade>();
  private readonly agencyPersonnelFacades = new Map<
    string,
    AgencyPersonnelFacade
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
  private readonly locationPathFacades = new Map<string, LocationPathFacade>();
  private readonly locationPathAliasFacades = new Map<
    string,
    LocationPathAliasFacade
  >();
  private readonly disciplineFacades = new Map<
    string,
    EntityFacade<DisciplineRow, DisciplineEnvelope>
  >();
  private readonly disciplineAgencyOfficerFacades = new Map<
    string,
    EntityFacade<DisciplineAgencyOfficerRow, DisciplineAgencyOfficerEnvelope>
  >();
  private readonly coverageLinkFacades = new Map<
    string,
    EntityFacade<CoverageLinkRow, CoverageLinkEnvelope>
  >();
  private readonly coverageLinkAgencyOfficerFacades = new Map<
    string,
    EntityFacade<
      CoverageLinkAgencyOfficerRow,
      CoverageLinkAgencyOfficerEnvelope
    >
  >();
  private readonly agencyPhoneNumberFacades = new Map<
    string,
    EntityFacade<AgencyPhoneNumberRow, AgencyPhoneNumberEnvelope>
  >();
  private readonly federalAgencyFacades = new Map<
    string,
    EntityFacade<FederalAgencyRow, FederalAgencyEnvelope>
  >();
  private readonly federalAgencyBranchFacades = new Map<
    string,
    EntityFacade<FederalAgencyBranchRow, FederalAgencyBranchEnvelope>
  >();
  private readonly civilCaseFacades = new Map<
    string,
    EntityFacade<CivilCaseRow, CivilCaseEnvelope>
  >();
  private readonly civilCaseOfficerFacades = new Map<
    string,
    EntityFacade<CivilCaseOfficerRow, CivilCaseOfficerEnvelope>
  >();
  private readonly civilCaseLinkFacades = new Map<
    string,
    EntityFacade<CivilCaseLinkRow, CivilCaseLinkEnvelope>
  >();

  constructor(options: DataContextOptions) {
    this.client = options.client;
    this.logger = options.logger;
    this.resolveAddressFn = options.resolveAddress;
    this.resolveAdministrativeArea = options.resolveAdministrativeArea;
    this.resolvedPropertyStore = options.resolvedPropertyStore;
    this.commandName = options.commandName;
    this.ledger = options.ledger;
    this.locations = new LocationDataContext(this);
    this.locationPaths = new LocationPathDataContext(this);
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
        sourceFile: input.sourceFile,
        name: input.name,
        commandName: input.commandName ?? this.commandName,
      },
      backend: this.agencyResolverBackend(),
      cache: this.propertyCache(),
    });
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.agencyFacades.set(key, facade);
    return facade;
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

  private agencyResolverBackend(): AgencyResolverBackend {
    return {
      findOrCreateCanonicalId: (input) => this.findOrCreateCanonicalId(input),
      existingRow: (id) =>
        this.getById("Agency", id),
      ensureUniqueAgencySlug: (input) =>
        this.ensureUniqueSlug("Agency", input),
      registerAgencySlug: (input) => {
        this.registerSlug("Agency", input.slug, input.canonicalId);
      },
      resolveAgencyLocation: (input) => this.locations.resolveAddress(input),
    };
  }

  addAgencyRecords(artifacts: ArtifactsEnvelope): void {
    for (const artifact of artifacts.spec.artifacts.filter(
      (item) => item.kind === "Agencies",
    )) {
      for (const [recordName, record] of Object.entries(
        artifact.spec.records,
      )) {
        this.fromSource({
          apiVersion: INTAKE_API_VERSION,
          namespace: artifacts.metadata.namespace,
          name: sourceNameForImportRecord(recordName, record),
          spec: valueAsRecord(record),
        });
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
        sourceFile: input.sourceFile,
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
      findOrCreateCanonicalId: (input) => this.findOrCreateCanonicalId(input),
      existingRow: (id) =>
        this.getById("Personnel", id),
      ensureUniquePersonnelSlug: (input) =>
        this.ensureUniqueSlug("Personnel", input),
      registerPersonnelSlug: (input) => {
        this.registerSlug("Personnel", input.slug, input.canonicalId);
      },
    };
  }

  private slugClaimsFor(kind: SlugKind): Map<string, string> {
    let claims = this.slugClaimsByKind.get(kind);
    if (claims === undefined) {
      claims = new Map();
      this.slugClaimsByKind.set(kind, claims);
    }
    return claims;
  }

  private slugDatabaseOwnerFor(
    kind: SlugKind,
  ): Map<string, string | null> {
    let owners = this.slugDatabaseOwnerByKind.get(kind);
    if (owners === undefined) {
      owners = new Map();
      this.slugDatabaseOwnerByKind.set(kind, owners);
    }
    return owners;
  }

  /** Register a resolved slug so a later generated slug disambiguates from it. */
  private registerSlug(
    kind: SlugKind,
    slug: string,
    canonicalId: string,
  ): void {
    this.slugClaimsFor(kind).set(slug, canonicalId);
  }

  /**
   * Generate a slug unique across the three resolution levels for `table`: the
   * current command (in-memory claims), intake-owned state, and the database —
   * appending a numeric suffix until free, then registering the claim. Because a
   * durably-resolved slug is persisted to the database on import, the database
   * read is the durable authority for the state level.
   */
  private async ensureUniqueSlug(
    kind: SlugKind,
    input: { base: string; canonicalId: string },
  ): Promise<string> {
    const claims = this.slugClaimsFor(kind);
    for (let attempt = 1; ; attempt += 1) {
      const candidate = attempt === 1 ? input.base : `${input.base}-${attempt}`;
      const claimant = claims.get(candidate);
      if (claimant !== undefined) {
        if (claimant === input.canonicalId) {
          return candidate;
        }
        continue;
      }
      const databaseOwner = await this.slugDatabaseOwnerId(kind, candidate);
      if (databaseOwner !== undefined && databaseOwner !== input.canonicalId) {
        continue;
      }
      claims.set(candidate, input.canonicalId);
      return candidate;
    }
  }

  private async slugDatabaseOwnerId(
    kind: SlugKind,
    slug: string,
  ): Promise<string | undefined> {
    const owners = this.slugDatabaseOwnerFor(kind);
    const cached = owners.get(slug);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    const row = await this.getById(kind, slug, "slug");
    const owner = row === undefined ? undefined : valueAsString(row.id);
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
        existing.merge(input.spec);
      }
      return existing;
    }
    const facade = new AgencyPersonnelFacade({
      current: input.current,
      source: {
        namespace: input.namespace,
        sourceFile: input.sourceFile,
        name: input.name,
        commandName: input.commandName ?? this.commandName,
      },
      backend: this.agencyPersonnelResolverBackend(),
    });
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.agencyPersonnelFacades.set(key, facade);
    return facade;
  }

  private agencyPersonnelResolverBackend(): LicenseResolverBackend {
    return {
      findOrCreateCanonicalId: (input) => this.findOrCreateCanonicalId(input),
      existingRow: (id) => this.getById("AgencyPersonnel", id),
      findForeignKeyTarget: (input) => this.findForeignKeyTarget(input),
    };
  }

  locationPathFromSource(input: SourceRecordContext): LocationPathFacade {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "LocationPath",
      input.name,
    ].join(":");
    const existing = this.locationPathFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) {
        existing.merge(input.spec);
      }
      return existing;
    }
    const facade = new LocationPathFacade({
      current: input.current,
      source: {
        namespace: input.namespace,
        sourceFile: input.sourceFile,
        name: input.name,
        commandName: input.commandName ?? this.commandName,
      },
      backend: this.resolverBackend("LocationPath", "location_path_id"),
    });
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.locationPathFacades.set(key, facade);
    return facade;
  }

  locationPathAliasFromSource(
    input: SourceRecordContext,
  ): LocationPathAliasFacade {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "LocationPathAlias",
      input.name,
    ].join(":");
    const existing = this.locationPathAliasFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) {
        existing.merge(input.spec);
      }
      return existing;
    }
    const facade = new LocationPathAliasFacade({
      current: input.current,
      source: {
        namespace: input.namespace,
        sourceFile: input.sourceFile,
        name: input.name,
        commandName: input.commandName ?? this.commandName,
      },
      backend: this.resolverBackend("LocationPathAlias", "alias_path"),
    });
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.locationPathAliasFacades.set(key, facade);
    return facade;
  }

  // Generic backend (ADR 0016/0019): canonical-id find-or-create, lazy current-row
  // read by identityColumn, same-source FK finds. Richer facades compose their own.
  private resolverBackend(
    kind: string,
    identityColumn?: string,
  ): LicenseResolverBackend {
    return {
      findOrCreateCanonicalId: (input) => this.findOrCreateCanonicalId(input),
      existingRow: (id) => this.getById(kind, id, identityColumn),
      findForeignKeyTarget: (input) => this.findForeignKeyTarget(input),
    };
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
        sourceFile: input.sourceFile,
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
      findOrCreateCanonicalId: (input) => this.findOrCreateCanonicalId(input),
      existingRow: (id) =>
        this.getById("LicensingAuthority", id),
    };
  }

  licenseFromSource(input: SourceRecordContext): LicenseFacade {
    validateSourceRecordContext(input);
    const key = [input.apiVersion, input.namespace, "License", input.name].join(
      ":",
    );
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
        sourceFile: input.sourceFile,
        name: input.name,
        commandName: input.commandName ?? this.commandName,
      },
      backend: this.licenseResolverBackend("License"),
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
        sourceFile: input.sourceFile,
        name: input.name,
        commandName: input.commandName ?? this.commandName,
      },
      backend: this.licenseResolverBackend("LicenseAction"),
    });
    if (input.spec !== undefined) {
      facade.merge(input.spec);
    }
    this.licenseActionFacades.set(key, facade);
    return facade;
  }

  private licenseResolverBackend(kind: string): LicenseResolverBackend {
    return {
      findOrCreateCanonicalId: (input) => this.findOrCreateCanonicalId(input),
      existingRow: (id) => this.getById(kind, id),
      findForeignKeyTarget: (input) => this.findForeignKeyTarget(input),
    };
  }

  /**
   * The existing database row for a resolved canonical id, read lazily at
   * mutation time (ADR 0019): the read is enqueued and coalesced with every
   * other read requested in the same tick into one `where <col> = any($1)`,
   * then memoized. No bulk current-row read at startup.
   */
  private tableForKind(kind: string): SupportedTableName {
    const table = TABLE_BY_KIND[kind];
    if (table === undefined) {
      throw new Error(`No table is mapped for record kind ${kind}.`);
    }
    return table as SupportedTableName;
  }

  getById(
    kind: string,
    id: string,
    identityColumn = "id",
  ): Promise<Record<string, unknown> | undefined> {
    return this.rowByColumn(this.tableForKind(kind), id, identityColumn);
  }

  private rowByColumn(
    tableName: SupportedTableName,
    id: string,
    identityColumn = "id",
  ): Promise<Record<string, unknown> | undefined> {
    const cacheKey = `${tableName}:${identityColumn}:${id}`;
    let pending = this.lazyCurrentRowCache.get(cacheKey);
    if (pending === undefined) {
      pending = this.enqueueRowRead(tableName, identityColumn, id);
      this.lazyCurrentRowCache.set(cacheKey, pending);
    }
    return pending;
  }

  private enqueueRowRead(
    tableName: SupportedTableName,
    identityColumn: string,
    id: string,
  ): Promise<Record<string, unknown> | undefined> {
    const batchKey = `${tableName}:${identityColumn}`;
    let batch = this.pendingRowReads.get(batchKey);
    if (batch === undefined) {
      batch = { tableName, identityColumn, requests: new Map() };
      this.pendingRowReads.set(batchKey, batch);
    }
    return new Promise((resolve, reject) => {
      batch.requests.set(id, { resolve, reject });
      if (!this.rowReadFlushScheduled) {
        this.rowReadFlushScheduled = true;
        // setImmediate, not queueMicrotask: a group's facades reach this read
        // spread across many microtasks (FK and slug resolution), so a microtask
        // flush fires before they gather and each read runs alone. Deferring to
        // the macrotask boundary lets the whole group batch into one query.
        setImmediate(() => void this.flushRowReads());
      }
    });
  }

  private async flushRowReads(): Promise<void> {
    this.rowReadFlushScheduled = false;
    const batches = [...this.pendingRowReads.values()].filter(
      (batch) => batch.requests.size > 0,
    );
    this.pendingRowReads.clear();
    if (batches.length === 0) return;
    if (batches.length === 1) {
      await this.runRowReadBatch(batches[0]);
      return;
    }
    // Fold the pending per-table batches into one UNION ALL round-trip rather
    // than a concurrent query each (which overlaps on the single read client).
    const selects = batches.map(
      (batch, index) =>
        `select ${index} as __batch, row_to_json(t.*) as __row ` +
        `from ${batch.tableName} t where ${batch.identityColumn} = any($${index + 1})`,
    );
    const params = batches.map((batch) => [...new Set(batch.requests.keys())]);
    try {
      const result = await this.databaseClient().query(
        selects.join(" union all "),
        params,
      );
      const rowsByBatch = batches.map(
        () => new Map<string, Record<string, unknown>>(),
      );
      for (const item of searchRows(result)) {
        const index = Number(item.__batch);
        const row = (item.__row ?? {}) as Record<string, unknown>;
        const id = row[batches[index].identityColumn];
        if (id !== undefined && id !== null) {
          rowsByBatch[index].set(String(id), row);
        }
      }
      batches.forEach((batch, index) => {
        for (const [id, request] of batch.requests) {
          request.resolve(rowsByBatch[index].get(id));
        }
      });
    } catch (error) {
      for (const batch of batches) {
        for (const request of batch.requests.values()) request.reject(error);
      }
    }
  }

  private async runRowReadBatch(batch: RowReadBatch): Promise<void> {
    try {
      const rows = await readDatabaseRecordsByColumn(
        this.databaseClient(),
        batch.tableName,
        batch.identityColumn,
        [...batch.requests.keys()],
      );
      const rowByKey = new Map(
        rows.map((row) => [String(row[batch.identityColumn]), row] as const),
      );
      for (const [id, request] of batch.requests) {
        request.resolve(rowByKey.get(id));
      }
    } catch (error) {
      for (const request of batch.requests.values()) {
        request.reject(error);
      }
    }
  }


  /**
   * Like {@link entityFacadeBackend} but for facade-owned entities with no
   * preload path (civil cases and friends): `existingRow` reads the one row
   * lazily via {@link rowByColumn}, coalesced into a batched `where id = any($1)`
   * (ADR 0019), so a re-import updates instead of failing on a duplicate id.
   */
  private entityFacadeBackendForKind(kind: string): EntityFacadeBackend {
    return {
      findOrCreateCanonicalId: (input) => this.findOrCreateCanonicalId(input),
      existingRow: (id) => this.getById(kind, id),
      findForeignKeyTarget: (input) => this.findForeignKeyTarget(input),
      getLocationPathByPath: (path) => this.locationPaths.getByPath(path),
    };
  }

  private entityFacadeSource(input: SourceRecordContext): FacadeSource {
    return {
      namespace: input.namespace,
      sourceFile: input.sourceFile,
      name: input.name,
      commandName: input.commandName ?? this.commandName,
    };
  }

  disciplineFromSource(
    input: SourceRecordContext,
  ): EntityFacade<DisciplineRow, DisciplineEnvelope> {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "Discipline",
      input.name,
    ].join(":");
    const existing = this.disciplineFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) existing.merge(input.spec);
      return existing;
    }
    const facade = createDisciplineFacade({
      current: input.current,
      source: this.entityFacadeSource(input),
      backend: this.entityFacadeBackendForKind("Discipline"),
    });
    if (input.spec !== undefined) facade.merge(input.spec);
    this.disciplineFacades.set(key, facade);
    return facade;
  }

  disciplineAgencyOfficerFromSource(
    input: SourceRecordContext,
  ): EntityFacade<DisciplineAgencyOfficerRow, DisciplineAgencyOfficerEnvelope> {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "DisciplineAgencyOfficer",
      input.name,
    ].join(":");
    const existing = this.disciplineAgencyOfficerFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) existing.merge(input.spec);
      return existing;
    }
    const facade = createDisciplineAgencyOfficerFacade({
      current: input.current,
      source: this.entityFacadeSource(input),
      backend: this.entityFacadeBackendForKind("DisciplineAgencyOfficer"),
    });
    if (input.spec !== undefined) facade.merge(input.spec);
    this.disciplineAgencyOfficerFacades.set(key, facade);
    return facade;
  }

  coverageLinkFromSource(
    input: SourceRecordContext,
  ): EntityFacade<CoverageLinkRow, CoverageLinkEnvelope> {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "CoverageLink",
      input.name,
    ].join(":");
    const existing = this.coverageLinkFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) existing.merge(input.spec);
      return existing;
    }
    const facade = createCoverageLinkFacade({
      current: input.current,
      source: this.entityFacadeSource(input),
      backend: this.entityFacadeBackendForKind("CoverageLink"),
    });
    if (input.spec !== undefined) facade.merge(input.spec);
    this.coverageLinkFacades.set(key, facade);
    return facade;
  }

  coverageLinkAgencyOfficerFromSource(
    input: SourceRecordContext,
  ): EntityFacade<
    CoverageLinkAgencyOfficerRow,
    CoverageLinkAgencyOfficerEnvelope
  > {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "CoverageLinkAgencyOfficer",
      input.name,
    ].join(":");
    const existing = this.coverageLinkAgencyOfficerFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) existing.merge(input.spec);
      return existing;
    }
    const facade = createCoverageLinkAgencyOfficerFacade({
      current: input.current,
      source: this.entityFacadeSource(input),
      backend: this.entityFacadeBackendForKind("CoverageLinkAgencyOfficer"),
    });
    if (input.spec !== undefined) facade.merge(input.spec);
    this.coverageLinkAgencyOfficerFacades.set(key, facade);
    return facade;
  }

  agencyPhoneNumberFromSource(
    input: SourceRecordContext,
  ): EntityFacade<AgencyPhoneNumberRow, AgencyPhoneNumberEnvelope> {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "AgencyPhoneNumber",
      input.name,
    ].join(":");
    const existing = this.agencyPhoneNumberFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) existing.merge(input.spec);
      return existing;
    }
    const facade = createAgencyPhoneNumberFacade({
      current: input.current,
      source: this.entityFacadeSource(input),
      backend: this.entityFacadeBackendForKind("AgencyPhoneNumber"),
    });
    if (input.spec !== undefined) facade.merge(input.spec);
    this.agencyPhoneNumberFacades.set(key, facade);
    return facade;
  }

  federalAgencyFromSource(
    input: SourceRecordContext,
  ): EntityFacade<FederalAgencyRow, FederalAgencyEnvelope> {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "FederalAgency",
      input.name,
    ].join(":");
    const existing = this.federalAgencyFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) existing.merge(input.spec);
      return existing;
    }
    const facade = createFederalAgencyFacade({
      current: input.current,
      source: this.entityFacadeSource(input),
      backend: this.entityFacadeBackendForKind("FederalAgency"),
    });
    if (input.spec !== undefined) facade.merge(input.spec);
    this.federalAgencyFacades.set(key, facade);
    return facade;
  }

  federalAgencyBranchFromSource(
    input: SourceRecordContext,
  ): EntityFacade<FederalAgencyBranchRow, FederalAgencyBranchEnvelope> {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "FederalAgencyBranch",
      input.name,
    ].join(":");
    const existing = this.federalAgencyBranchFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) existing.merge(input.spec);
      return existing;
    }
    const facade = createFederalAgencyBranchFacade({
      current: input.current,
      source: this.entityFacadeSource(input),
      backend: this.entityFacadeBackendForKind("FederalAgencyBranch"),
    });
    if (input.spec !== undefined) facade.merge(input.spec);
    this.federalAgencyBranchFacades.set(key, facade);
    return facade;
  }

  civilCaseFromSource(
    input: SourceRecordContext,
  ): EntityFacade<CivilCaseRow, CivilCaseEnvelope> {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "CivilCase",
      input.name,
    ].join(":");
    const existing = this.civilCaseFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) existing.merge(input.spec);
      return existing;
    }
    const facade = createCivilCaseFacade({
      current: input.current,
      source: this.entityFacadeSource(input),
      backend: this.entityFacadeBackendForKind("CivilCase"),
    });
    if (input.spec !== undefined) facade.merge(input.spec);
    this.civilCaseFacades.set(key, facade);
    return facade;
  }

  civilCaseOfficerFromSource(
    input: SourceRecordContext,
  ): EntityFacade<CivilCaseOfficerRow, CivilCaseOfficerEnvelope> {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "CivilCaseOfficer",
      input.name,
    ].join(":");
    const existing = this.civilCaseOfficerFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) existing.merge(input.spec);
      return existing;
    }
    const facade = createCivilCaseOfficerFacade({
      current: input.current,
      source: this.entityFacadeSource(input),
      backend: this.entityFacadeBackendForKind("CivilCaseOfficer"),
    });
    if (input.spec !== undefined) facade.merge(input.spec);
    this.civilCaseOfficerFacades.set(key, facade);
    return facade;
  }

  civilCaseLinkFromSource(
    input: SourceRecordContext,
  ): EntityFacade<CivilCaseLinkRow, CivilCaseLinkEnvelope> {
    validateSourceRecordContext(input);
    const key = [
      input.apiVersion,
      input.namespace,
      "CivilCaseLink",
      input.name,
    ].join(":");
    const existing = this.civilCaseLinkFacades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) existing.merge(input.spec);
      return existing;
    }
    const facade = createCivilCaseLinkFacade({
      current: input.current,
      source: this.entityFacadeSource(input),
      backend: this.entityFacadeBackendForKind("CivilCaseLink"),
    });
    if (input.spec !== undefined) facade.merge(input.spec);
    this.civilCaseLinkFacades.set(key, facade);
    return facade;
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
    if (input.kind === "LocationPath") {
      // A LocationPath's identity column is `location_path_id`, not `id`, so
      // bridge the FK's `value("id")` to the facade's identity column.
      const facade = this.locationPathFacades.get(key);
      return facade === undefined
        ? undefined
        : { value: () => facade.value("location_path_id") };
    }
    if (input.kind === "Agency") {
      // Await the Agency facade's own id resolver (find-or-create).
      return this.agencyFacades.get(key);
    }
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
    if (input.kind === "AgencyPersonnel") {
      return this.agencyPersonnelFacades.get(key);
    }
    if (input.kind === "Discipline") {
      return this.disciplineFacades.get(key);
    }
    if (input.kind === "CoverageLink") {
      return this.coverageLinkFacades.get(key);
    }
    if (input.kind === "FederalAgency") {
      return this.federalAgencyFacades.get(key);
    }
    if (input.kind === "CivilCase") {
      return this.civilCaseFacades.get(key);
    }
    return undefined;
  }

  async toMutations(): Promise<
    (
      | LocationPathCreateEnvelope
      | LocationPathReadEnvelope
      | LocationPathAliasCreateEnvelope
      | LocationPathAliasReadEnvelope
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
      | DisciplineEnvelope
      | DisciplineAgencyOfficerEnvelope
      | CoverageLinkEnvelope
      | CoverageLinkAgencyOfficerEnvelope
      | AgencyPhoneNumberEnvelope
      | FederalAgencyEnvelope
      | FederalAgencyBranchEnvelope
      | CivilCaseEnvelope
      | CivilCaseOfficerEnvelope
      | CivilCaseLinkEnvelope
    )[]
  > {
    // Drain in FK-dependency order (ADR 0016 #4/#9): paths before aliases — a
    // path's parent self-FK and an alias's target both find an already-drained path.
    const locationPaths = await Promise.all(
      [...this.locationPathFacades.values()].map((facade) =>
        facade.toMutation(),
      ),
    );
    const locationPathAliases = await Promise.all(
      [...this.locationPathAliasFacades.values()].map((facade) =>
        facade.toMutation(),
      ),
    );
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
    // AgencyPersonnel FK-find the Agency / Personnel / License facades, so those
    // must be resolved first; id resolution is idempotent/memoized, so this only
    // guarantees the facades are registered.
    const agencyPersonnel = await Promise.all(
      [...this.agencyPersonnelFacades.values()].map((facade) =>
        facade.toMutation(),
      ),
    );
    // Discipline + coverage attributions FK-find AgencyPersonnel (and the
    // discipline/coverage events), all registered above; the final apply order is
    // re-sorted by the FK-derived topo sort, so this only fixes registration.
    const disciplines = await Promise.all(
      [...this.disciplineFacades.values()].map((facade) => facade.toMutation()),
    );
    const coverageLinks = await Promise.all(
      [...this.coverageLinkFacades.values()].map((facade) =>
        facade.toMutation(),
      ),
    );
    const disciplineAgencyOfficers = await Promise.all(
      [...this.disciplineAgencyOfficerFacades.values()].map((facade) =>
        facade.toMutation(),
      ),
    );
    const coverageLinkAgencyOfficers = await Promise.all(
      [...this.coverageLinkAgencyOfficerFacades.values()].map((facade) =>
        facade.toMutation(),
      ),
    );
    // AgencyPhoneNumbers depend only on Agencies (already drained above).
    const agencyPhoneNumbers = await Promise.all(
      [...this.agencyPhoneNumberFacades.values()].map((facade) =>
        facade.toMutation(),
      ),
    );
    // FederalAgencies are independent; branches depend on FederalAgencies + Agencies.
    const federalAgencies = await Promise.all(
      [...this.federalAgencyFacades.values()].map((facade) =>
        facade.toMutation(),
      ),
    );
    const federalAgencyBranches = await Promise.all(
      [...this.federalAgencyBranchFacades.values()].map((facade) =>
        facade.toMutation(),
      ),
    );
    // Civil cases before their officers/links (FK targets).
    const civilCases = await Promise.all(
      [...this.civilCaseFacades.values()].map((facade) => facade.toMutation()),
    );
    const civilCaseOfficers = await Promise.all(
      [...this.civilCaseOfficerFacades.values()].map((facade) =>
        facade.toMutation(),
      ),
    );
    const civilCaseLinks = await Promise.all(
      [...this.civilCaseLinkFacades.values()].map((facade) =>
        facade.toMutation(),
      ),
    );
    return [
      // Paths + aliases first: FK targets for the entities below, dependents of none.
      ...locationPaths,
      ...locationPathAliases,
      ...agencies,
      ...personnel,
      ...licensingAuthorities,
      ...licenses,
      ...licenseActions,
      // AgencyPersonnel last: agency_officers.license_id is a FK to license, so
      // licenses must be inserted before the assignments that reference them
      // (dependsOn: Agencies, Personnel, Licenses).
      ...agencyPersonnel,
      ...disciplines,
      ...coverageLinks,
      ...disciplineAgencyOfficers,
      ...coverageLinkAgencyOfficers,
      ...agencyPhoneNumbers,
      ...federalAgencies,
      ...federalAgencyBranches,
      ...civilCases,
      ...civilCaseOfficers,
      ...civilCaseLinks,
    ];
  }

  async toDatabaseMutationItems(): Promise<DatabaseMutationItem[]> {
    const facadeMutations = (await this.toMutations()).map((mutation) => ({
      kind: mutation.kind,
      name: mutation.metadata.name,
      spec: mutation.spec,
    }));

    // Every entity emits through its facade (ADR 0016); the transform rows are
    // validation/exclusion substrate, never an emission input.
    const items: DatabaseMutationItem[] = [...facadeMutations];

    // Drop check-only updates: an update whose operations are all `check` mutates
    // nothing, so it is not a mutation (ADR 0011/0014). Filtering here — the one
    // point every facade and location-path mutation flows through — keeps the
    // emitted plan to genuine changes, so a re-import of an already-matching
    // dataset yields an empty (no-op) plan rather than a wall of no-op updates.
    return sortByDependencyOrder(
      items.filter((item) => !isCheckOnlyUpdateItem(item)),
    );
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

  databaseClient(): DatabaseClient {
    if (this.client === undefined) {
      throw new Error("Database client is required for database reads.");
    }
    return this.client;
  }

}

function searchRows(result: unknown): Record<string, unknown>[] {
  return typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray((result as { rows?: unknown[] }).rows)
    ? (result as { rows: Record<string, unknown>[] }).rows
    : [];
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

  // A location_path_id source key is the full path string; resolve it by a lazy
  // per-reference read of the census-owned tables (ADR 0024): the location_path
  // by `path`, else the location_path_alias by `alias_path`. The caller (a field
  // resolver) caches the hit and fails loud when neither matches.
  async getByPath(path: string): Promise<LocationPathRow | undefined> {
    const client = this.context.databaseClient();
    const direct = await readLocationPathByPath(client, path);
    if (direct !== undefined) {
      return direct;
    }
    const alias = await readLocationPathAliasByPath(client, path);
    return alias === undefined
      ? undefined
      : readLocationPathById(client, alias.location_path_id);
  }

  async getById(locationPathId: string): Promise<LocationPathRow | undefined> {
    return readLocationPathById(this.context.databaseClient(), locationPathId);
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

}
