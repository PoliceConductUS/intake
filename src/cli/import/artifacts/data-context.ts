import { createId } from "@paralleldrive/cuid2";
import {
  Resolver,
  valueAsString,
  type PropertyResolutionFacade,
  type PropertyCache,
  type ForeignKeyIdSource,
  type ResolverContext,
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
  buildFacadeForKind,
  identityColumnForKind,
} from "./facades/resolver-registry.js";
import {
  RECORD_KINDS_IN_DEPENDENCY_ORDER,
  RESOLVED_PROPERTIES,
  TABLE_BY_KIND,
  type LocationPathRow,
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
import { SlugAllocator } from "./slug.js";
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
  private readonly resolvedPropertyStore?: ResolvedPropertyStore;
  private readonly commandName?: string;
  private readonly ledger?: SourceNameToCanonicalIdLedger;
  private readonly slugs: SlugAllocator;
  private readonly agencyFacades = new Map<string, RegistryFacade>();
  private readonly personnelFacades = new Map<string, RegistryFacade>();
  private readonly agencyPersonnelFacades = new Map<string, RegistryFacade>();
  private readonly licensingAuthorityFacades = new Map<
    string,
    RegistryFacade
  >();
  private readonly licenseFacades = new Map<string, RegistryFacade>();
  private readonly licenseActionFacades = new Map<string, RegistryFacade>();
  private readonly locationPathFacades = new Map<string, RegistryFacade>();
  private readonly locationPathAliasFacades = new Map<string, RegistryFacade>();
  private readonly disciplineFacades = new Map<string, RegistryFacade>();
  private readonly disciplineAgencyOfficerFacades = new Map<
    string,
    RegistryFacade
  >();
  private readonly coverageLinkFacades = new Map<string, RegistryFacade>();
  private readonly coverageLinkAgencyOfficerFacades = new Map<
    string,
    RegistryFacade
  >();
  private readonly agencyPhoneNumberFacades = new Map<string, RegistryFacade>();
  private readonly federalAgencyFacades = new Map<string, RegistryFacade>();
  private readonly federalAgencyBranchFacades = new Map<
    string,
    RegistryFacade
  >();
  private readonly civilCaseFacades = new Map<string, RegistryFacade>();
  private readonly civilCaseOfficerFacades = new Map<string, RegistryFacade>();
  private readonly civilCaseLinkFacades = new Map<string, RegistryFacade>();

  constructor(options: DataContextOptions) {
    this.client = options.client;
    this.logger = options.logger;
    this.resolveAddressFn = options.resolveAddress;
    this.resolvedPropertyStore = options.resolvedPropertyStore;
    this.commandName = options.commandName;
    this.ledger = options.ledger;
    this.slugs = new SlugAllocator(async (kind, slug) => {
      const row = await this.getById(kind, slug, "slug");
      return row === undefined ? undefined : valueAsString(row.id);
    });
    this.locations = new LocationDataContext(this);
    this.locationPaths = new LocationPathDataContext(this);
  }

  fromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource("Agency", this.agencyFacades, input);
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

  personnelFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "Personnel",
      this.personnelFacades,
      input,
    );
  }


  agencyPersonnelFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "AgencyPersonnel",
      this.agencyPersonnelFacades,
      input,
    );
  }

  locationPathFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "LocationPath",
      this.locationPathFacades,
      input,
    );
  }

  locationPathAliasFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "LocationPathAlias",
      this.locationPathAliasFacades,
      input,
    );
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
      existingRow: (id) => this.getById(kind, id, identityColumn),
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
  private registryFacadeFromSource(
    kind: string,
    facades: Map<string, RegistryFacade>,
    input: SourceRecordContext,
  ): RegistryFacade {
    validateSourceRecordContext(input);
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

  licensingAuthorityFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "LicensingAuthority",
      this.licensingAuthorityFacades,
      input,
    );
  }

  licenseFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "License",
      this.licenseFacades,
      input,
    );
  }

  licenseActionFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "LicenseAction",
      this.licenseActionFacades,
      input,
    );
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


  disciplineFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "Discipline",
      this.disciplineFacades,
      input,
    );
  }

  disciplineAgencyOfficerFromSource(
    input: SourceRecordContext,
  ): RegistryFacade {
    return this.registryFacadeFromSource(
      "DisciplineAgencyOfficer",
      this.disciplineAgencyOfficerFacades,
      input,
    );
  }

  coverageLinkFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "CoverageLink",
      this.coverageLinkFacades,
      input,
    );
  }

  coverageLinkAgencyOfficerFromSource(
    input: SourceRecordContext,
  ): RegistryFacade {
    return this.registryFacadeFromSource(
      "CoverageLinkAgencyOfficer",
      this.coverageLinkAgencyOfficerFacades,
      input,
    );
  }

  agencyPhoneNumberFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "AgencyPhoneNumber",
      this.agencyPhoneNumberFacades,
      input,
    );
  }

  federalAgencyFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "FederalAgency",
      this.federalAgencyFacades,
      input,
    );
  }

  federalAgencyBranchFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "FederalAgencyBranch",
      this.federalAgencyBranchFacades,
      input,
    );
  }

  civilCaseFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "CivilCase",
      this.civilCaseFacades,
      input,
    );
  }

  civilCaseOfficerFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "CivilCaseOfficer",
      this.civilCaseOfficerFacades,
      input,
    );
  }

  civilCaseLinkFromSource(input: SourceRecordContext): RegistryFacade {
    return this.registryFacadeFromSource(
      "CivilCaseLink",
      this.civilCaseLinkFacades,
      input,
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
    // Registry facades resolve toward an erased row, so bridge `value("id")` to
    // the target's identity column (LocationPath keys on `location_path_id`).
    const registryFacadeByKind: Record<
      string,
      Map<string, RegistryFacade> | undefined
    > = {
      Agency: this.agencyFacades,
      Personnel: this.personnelFacades,
      LocationPath: this.locationPathFacades,
      LicensingAuthority: this.licensingAuthorityFacades,
      License: this.licenseFacades,
      AgencyPersonnel: this.agencyPersonnelFacades,
      Discipline: this.disciplineFacades,
      CoverageLink: this.coverageLinkFacades,
      FederalAgency: this.federalAgencyFacades,
      CivilCase: this.civilCaseFacades,
    };
    const facades = registryFacadeByKind[input.kind];
    if (facades === undefined) {
      return undefined;
    }
    const facade = facades.get(key);
    if (facade === undefined) {
      return undefined;
    }
    const identityColumn = identityColumnForKind(input.kind);
    return { value: () => facade.value(identityColumn) as Promise<string> };
  }

  async toMutations(): Promise<DatabaseMutationEnvelope[]> {
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
