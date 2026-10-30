import { createHash } from "node:crypto";
import { inspectDataAnnotationFindings } from "../../../shared/inspect-data-annotations.js";
import {
  SourceValues,
  type DataAnnotation,
} from "../../../shared/data-annotations.js";
import type { AgencyLocationPathLookup } from "../../../shared/agency-location-path.js";
import type { InitialAgencyRootsEnvelope } from "../../../shared/io/index.js";
import {
  AGENCY_GRAPH_COLUMNS,
  graphKey,
  selectAgencyGraph,
  type AgencyGraphRecord,
} from "./agency-graph.js";
import type { ApplyPropertyCorrections } from "../../../shared/io/property-corrections.js";
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
  urlOwnershipForKind,
} from "./facades/resolver-registry.js";
import {
  BUSINESS_KEYS,
  RECORD_KINDS_IN_DEPENDENCY_ORDER,
} from "../../../shared/io/generated/entity-specs.js";
import { INTAKE_API_VERSION } from "../../../shared/io/import-types.js";
import type { DatabaseClient } from "../../database/index.js";
import { SlugAllocator } from "./slug.js";
import { CurrentRowReader } from "./current-row-reader.js";
import {
  isCheckOnlyUpdateItem,
  planDatabaseMutationItems,
} from "./mutation-plan.js";
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
import type {
  ResolvedPropertyCacheInput,
  ResolvedPropertySource,
} from "../../state/resolved-property/index.js";

/**
 * The workspace `ResolvedProperty` store, adapted to `(input) -> value`. The
 * agency facade's `PropertyCache` reads and writes resolved properties (and
 * seeds) through it (ADR 0019).
 */
type ResolvedPropertyStore = {
  read(input: ResolvedPropertyCacheInput): Promise<unknown | undefined>;
  write(
    input: ResolvedPropertyCacheInput & {
      value: unknown;
      source?: ResolvedPropertySource;
    },
  ): Promise<void>;
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
  info?(message: string): void;
  debug?(object: Record<string, unknown>, message: string): void;
};

export type DataContextOptions = {
  /** One UTC validation day for the whole import, injectable for reproducible tests. */
  validationDate?: Date;
  applyPropertyCorrections?: ApplyPropertyCorrections;
  propertyCorrectionNamespace?: string;
  client?: DatabaseClient;
  logger?: DataContextLogger;
  resolveAddress?: (
    input: AddressResolutionRequest,
  ) => Promise<AddressResolution | undefined>;
  resolvedPropertyStore?: ResolvedPropertyStore;
  /** Established canonical cache ownership, including entities absent from this import. */
  lookupCachedSlugOwner?: (
    kind: string,
    slug: string,
  ) => Promise<string | undefined>;
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
  /** The record's write verb and addressing (ADR 0034), from its metadata. */
  action?: "PUT" | "PATCH" | "POST";
  selector?: Record<string, unknown>;
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
  getLocationPathById: AgencyLocationPathLookup;
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
  resolveAgencyLocation(
    input: ResolveAddressInput,
  ): Promise<LocationResolution>;
  resolveAgencyCoordinates(
    input: ResolveAddressInput,
  ): Promise<AddressResolution>;
};

// Keep same-tick coalescing within each batch without retaining pending work
// for an entire kind. Read the next batch only after this one has completed.
function resolveInBatches<Input, Output>(
  inputs: Iterable<Input>,
  resolve: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const iterator = inputs[Symbol.iterator]();
  const results: Output[] = [];
  function nextBatch(): Promise<Output[]> {
    const batch: Promise<Output>[] = [];
    while (batch.length < 1000) {
      const next = iterator.next();
      if (next.done) break;
      batch.push(resolve(next.value));
    }
    if (batch.length === 0) return Promise.resolve(results);
    return Promise.all(batch).then((resolved) => {
      for (const result of resolved) results.push(result);
      return nextBatch();
    });
  }
  return Promise.resolve().then(nextBatch);
}

export class DataContext {
  readonly locations: LocationDataContext;
  readonly locationPaths: LocationPathDataContext;
  private readonly applyPropertyCorrections?: ApplyPropertyCorrections;
  private readonly propertyCorrectionNamespace?: string;
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
  private readonly validationDate: Date;
  private readonly ledger?: SourceNameToCanonicalIdLedger;
  private readonly slugs: SlugAllocator;
  /** Every facade built this command, grouped by kind then memo key. */
  private readonly facadesByKind = new Map<
    string,
    Map<string, RegistryFacade>
  >();
  private readonly resolverBackends = new Map<
    string,
    Map<string | undefined, UnifiedFacadeBackend>
  >();
  // Rows emitted this run, so existingRow finds a same-run create the same way it
  // finds a prior-run row — one convergence path (ADR 0016). Keyed kind\nidentity.
  private readonly emittedRows = new Map<string, Record<string, unknown>>();

  private static emittedKey(kind: string, identity: string): string {
    return `${kind}\n${identity}`;
  }

  // Memoized business-key → canonical id (ADR 0016): concurrent facades with the
  // same business key share one pending find-or-mint, so they converge on one id.
  private readonly businessKeyIds = new Map<string, Promise<string>>();

  constructor(options: DataContextOptions) {
    this.applyPropertyCorrections = options.applyPropertyCorrections;
    this.propertyCorrectionNamespace = options.propertyCorrectionNamespace;
    this.client = options.client;
    this.rows = new CurrentRowReader(options.client);
    this.logger = options.logger;
    this.resolveAddressFn = options.resolveAddress;
    this.resolvedPropertyStore = options.resolvedPropertyStore;
    this.commandName = options.commandName;
    this.validationDate = options.validationDate ?? new Date();
    this.ledger = options.ledger;
    this.slugs = new SlugAllocator(async (kind, slug) => {
      const [row, cachedOwner] = await Promise.all([
        this.rows.getById(kind, slug, "slug"),
        options.lookupCachedSlugOwner?.(kind, slug),
      ]);
      const databaseOwner =
        row === undefined ? undefined : valueAsString(row.id);
      if (
        databaseOwner !== undefined &&
        cachedOwner !== undefined &&
        databaseOwner !== cachedOwner
      ) {
        throw new Error(
          `Canonical slug conflict for ${kind}: ${slug} belongs to database ${databaseOwner} and cache ${cachedOwner}.`,
        );
      }
      return databaseOwner ?? cachedOwner;
    });
    this.locations = new LocationDataContext(this);
    this.locationPaths = new LocationPathDataContext(this);
  }

  /**
   * Adapts the workspace `ResolvedProperty` store to the facade `PropertyCache`,
   * keyed by `(kind, canonical id, property)`. Automatic resolutions and CLI
   * corrections share this store and cache lookup — no source- or
   * property-specific code (ADR 0019).
   */
  private propertyCache(): PropertyCache | undefined {
    const cache = this.resolvedPropertyStore;
    if (cache === undefined) {
      return undefined;
    }
    return {
      read: ({ kind, id, property, inputFingerprint }) =>
        cache.read({
          subject: { apiVersion: INTAKE_API_VERSION, kind, name: id },
          targetProperty: property,
          getLocationPathById: (id) => this.locationPaths.getById(id),
          inputFingerprint,
        }),
      write: ({ kind, id, property, inputFingerprint, source }, value) =>
        cache.write({
          subject: { apiVersion: INTAKE_API_VERSION, kind, name: id },
          targetProperty: property,
          getLocationPathById: (id) => this.locationPaths.getById(id),
          inputFingerprint,
          value,
          ...(source === undefined
            ? {}
            : {
                source: {
                  namespace: source.namespace,
                  kind,
                  name: source.name,
                },
              }),
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
    let backends = this.resolverBackends.get(kind);
    if (backends === undefined) {
      backends = new Map();
      this.resolverBackends.set(kind, backends);
    }
    const existing = backends.get(identityColumn);
    if (existing !== undefined) return existing;

    // These capabilities capture only the context, kind, and identity column;
    // every facade supplies its own record-specific arguments when resolving.
    const backend: UnifiedFacadeBackend = {
      findCanonicalId: (input) => this.findCanonicalId(input),
      findOrCreateCanonicalId: (input) => this.findOrCreateCanonicalId(input),
      businessKeyId: (key, resolve) => this.businessKeyId(kind, key, resolve),
      findIdByBusinessKey: (values) => this.findIdByBusinessKey(kind, values),
      mintId: () => createId(),
      existingRow: (id) => {
        const emitted = this.emittedRows.get(DataContext.emittedKey(kind, id));
        return emitted !== undefined
          ? Promise.resolve(emitted)
          : this.rows.getById(kind, id, identityColumn);
      },
      findForeignKeyTarget: (input) => this.findForeignKeyTarget(input),
      getLocationPathByPath: (path) => this.locationPaths.getByPath(path),
      getLocationPathById: (id) => this.locationPaths.getById(id),
      findRowsByColumns: (targetKind, columnValues) => {
        const identity = columnValues[identityColumnForKind(targetKind)];
        const emitted =
          typeof identity === "string"
            ? this.emittedRows.get(DataContext.emittedKey(targetKind, identity))
            : undefined;
        if (
          emitted !== undefined &&
          Object.entries(columnValues).every(
            ([key, value]) => emitted[key] === value,
          )
        )
          return Promise.resolve([emitted]);
        return this.rows.getRowsByColumns(targetKind, columnValues);
      },
      ensureUniqueSlug: (input) =>
        this.slugs.ensureUnique(input.kind, {
          base: input.base,
          canonicalId: input.canonicalId,
        }),
      registerSlug: (input) =>
        this.slugs.register(input.kind, input.slug, input.canonicalId),
      resolveAgencyLocation: (input) => this.locations.resolveAddress(input),
      resolveAgencyCoordinates: (input) =>
        this.locations.resolveCoordinates(input),
    };
    backends.set(identityColumn, backend);
    return backend;
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
    const rawSourceValues = input.spec;
    const correctionAnnotations: DataAnnotation[] = [];
    const correctedProperties: string[] = [];
    if (
      input.spec !== undefined &&
      this.applyPropertyCorrections !== undefined &&
      (this.propertyCorrectionNamespace === undefined ||
        this.propertyCorrectionNamespace === input.namespace)
    ) {
      input = {
        ...input,
        spec: this.applyPropertyCorrections(
          kind,
          input.name,
          input.spec,
          (property, annotation) => {
            correctedProperties.push(property);
            if (annotation !== undefined)
              correctionAnnotations.push(annotation);
          },
        ),
      };
    }
    const key = [input.apiVersion, input.namespace, kind, input.name].join(":");
    const facades = this.facadesFor(kind);
    const existing = facades.get(key);
    if (existing !== undefined) {
      if (input.spec !== undefined) {
        existing.merge(input.spec, correctedProperties);
        existing.recordSourceContribution(
          rawSourceValues!,
          correctionAnnotations,
        );
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
        action: input.action,
        selector: input.selector,
      },
      backend: this.resolverBackend(kind, identityColumnForKind(kind)),
      // The property cache is gated by RESOLVED_PROPERTIES[kind]: a kind with no
      // cache-backed properties never touches it (ADR 0019).
      cache: this.propertyCache(),
    }) as RegistryFacade;
    if (input.spec !== undefined) {
      facade.merge(input.spec, correctedProperties);
      facade.recordSourceContribution(rawSourceValues!, correctionAnnotations);
    }
    facades.set(key, facade);
    return facade;
  }

  // The find-only ledger read (the chain's "db source" link): an existing mapping
  // or undefined, never a mint. No ledger ⇒ nothing is recorded yet.
  private async findCanonicalId(input: {
    namespace: string;
    kind: string;
    sourceId: string;
  }): Promise<string | undefined> {
    if (this.ledger === undefined) {
      return undefined;
    }
    return this.ledger.read(
      input.namespace,
      input.kind as LedgerEntityKind,
      input.sourceId,
    );
  }

  // Cache / same-run tier: memoize the id per business key so concurrent same-key
  // facades share one pending find-or-mint and converge (ADR 0016).
  private businessKeyId(
    kind: string,
    key: string,
    resolve: () => Promise<string>,
  ): Promise<string> {
    const existing = this.businessKeyIds.get(key);
    if (existing !== undefined) {
      return existing;
    }
    // Intake owns the derived business-key name, shared across source variants.
    // Persist both recovered and minted IDs before releasing the result.
    const pending =
      this.ledger === undefined
        ? resolve()
        : this.ledger.findOrCreate(
            "intake",
            kind as LedgerEntityKind,
            key,
            resolve,
          );
    this.businessKeyIds.set(key, pending);
    return pending;
  }

  // Db tier: the existing row's id whose business-key columns hold these values.
  private async findIdByBusinessKey(
    kind: string,
    values: Record<string, string>,
  ): Promise<string | undefined> {
    if (this.client === undefined) {
      return undefined;
    }
    const row = await this.rows.getByColumns(kind, values);
    return row === undefined ? undefined : String(row.id);
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
    return {
      value: (property) =>
        facade.value(
          property === "id" ? identityColumn : property,
        ) as Promise<string>,
    };
  }

  /** Resolve only selection identities/edges, then retain reached source facades. */
  async selectAgencyGraph(
    readExisting: (
      incoming: readonly AgencyGraphRecord[],
    ) => Promise<AgencyGraphRecord[]>,
    initialRoots?: InitialAgencyRootsEnvelope,
    personnelRoots?: {
      namespace: string;
      personnelSourceNames: readonly string[];
    },
  ): Promise<Record<string, number>> {
    const candidates: Array<{ record: AgencyGraphRecord; sourceKey: string }> =
      [];
    for (const [kind, columns] of AGENCY_GRAPH_COLUMNS) {
      const facades = this.facadesByKind.get(kind);
      if (facades === undefined) continue;
      const identified = await resolveInBatches(
        facades,
        async ([sourceKey, facade]) => {
          const id = String(await facade.value(identityColumnForKind(kind)));
          const values: Record<string, unknown> = {};
          for (const column of columns) {
            // Omitted fields inherit the stored graph row. Do not invoke a required
            // FK resolver for an untouched PATCH field or invent a null end date.
            if (facade.raw(column) !== undefined)
              values[column] = await facade.value(column);
          }
          return { record: { kind, id, values }, sourceKey };
        },
      );
      for (const candidate of identified) candidates.push(candidate);
    }
    if (candidates.length === 0) return {};
    const incoming = candidates.map((candidate) => candidate.record);
    const rootSourceKeys = new Set(
      initialRoots?.spec.agencySourceNames.map((name) =>
        [
          INTAKE_API_VERSION,
          initialRoots.metadata.namespace,
          "Agency",
          name,
        ].join(":"),
      ),
    );
    const rootIds = candidates
      .filter(
        ({ record, sourceKey }) =>
          record.kind === "Agency" && rootSourceKeys.has(sourceKey),
      )
      .map(({ record }) => record.id);
    if (initialRoots !== undefined) {
      this.logger?.debug?.(
        {
          namespace: initialRoots.metadata.namespace,
          configuredRoots: rootSourceKeys.size,
          matchedRoots: rootIds.length,
        },
        "Initial agency roots resolved against incoming candidates.",
      );
    }
    const personnelSourceKeys = new Set(
      personnelRoots?.personnelSourceNames.map((name) =>
        [INTAKE_API_VERSION, personnelRoots.namespace, "Personnel", name].join(
          ":",
        ),
      ),
    );
    const personnelIds = candidates
      .filter(
        ({ record, sourceKey }) =>
          record.kind === "Personnel" && personnelSourceKeys.has(sourceKey),
      )
      .map(({ record }) => record.id);
    const included = selectAgencyGraph(
      await readExisting(incoming),
      incoming,
      rootIds,
      personnelIds,
    );
    const omitted: Record<string, number> = {};
    for (const { record, sourceKey } of candidates) {
      if (included.has(graphKey(record))) continue;
      this.facadesByKind.get(record.kind)!.delete(sourceKey);
      omitted[record.kind] = (omitted[record.kind] ?? 0) + 1;
    }
    return omitted;
  }

  async toMutations(): Promise<DatabaseMutationEnvelope[]> {
    const mutations: DatabaseMutationEnvelope[] = [];
    await this.visitMutations((mutation) => mutations.push(mutation));
    return mutations;
  }

  private async visitMutations(
    visit: (mutation: DatabaseMutationEnvelope) => void,
  ): Promise<void> {
    // Every facade is registered during the add phase, so a FK find always locates
    // its target regardless of resolution order; the emitted plan is re-sorted by
    // the FK-derived topological sort in toDatabaseMutationItems. Draining in the
    // generated dependency order keeps the pre-sort output stable and legible.
    const existingAnnotations =
      this.client === undefined
        ? []
        : await this.rows.getRowsByColumns("DataAnnotation", {
            producer_namespace: "intake",
          });
    const existingScopes = new Set(
      existingAnnotations.map(
        (row) => String(row.producer_record_id).split("/")[0] + "/",
      ),
    );
    const annotationScopes = new Set<string>();
    const correctionFieldsByScope = new Map<string, ReadonlySet<string>>();
    const recordsByScope = new Map<
      string,
      Map<string, Record<string, unknown>>
    >();
    const inspectFacade = async (kind: string, facade: RegistryFacade) => {
      const { identityValue, resolved } = await facade.resolvedRow();
      this.emittedRows.set(
        DataContext.emittedKey(kind, identityValue),
        facade.inspectionValues,
      );
      const contribution = facade.contribution(resolved);
      // Only entity kinds carrying source evidence participate in automatic inspection.
      // Native annotations have no such column and do not recursively annotate themselves.
      if (contribution === undefined || !facade.supportsSourceEvidence) return;
      const groups = [
        {
          owner: [
            "correction",
            contribution.source_namespace,
            contribution.source_record_id,
          ],
          processedFields: new Set(Object.keys(contribution.values)),
          findings: contribution.corrections.map((annotation) => ({
            key: JSON.stringify(["correction", annotation.field]),
            annotation,
          })),
        },
        {
          owner: ["validation"],
          findings: inspectDataAnnotationFindings(
            kind,
            facade.inspectionValues,
            SourceValues.parse(
              facade.inspectionValues.data_source_values ?? {},
            ),
            this.validationDate,
          ),
        },
      ];
      for (const group of groups) {
        const scope =
          createHash("sha256")
            .update(JSON.stringify([kind, identityValue, ...group.owner]))
            .digest("hex") + "/";
        // Only existing findings need retirement bookkeeping. Valid records
        // with no prior findings must not allocate retained empty maps/sets.
        if (existingScopes.has(scope)) annotationScopes.add(scope);
        if (existingScopes.has(scope) && group.processedFields !== undefined)
          correctionFieldsByScope.set(scope, group.processedFields);
        if (group.findings.length === 0 && !existingScopes.has(scope)) {
          recordsByScope.delete(scope);
          continue;
        }
        const records = new Map<string, Record<string, unknown>>();
        recordsByScope.set(scope, records);
        for (const { key, annotation: finding } of group.findings) {
          const name =
            scope +
            createHash("sha256")
              .update(
                JSON.stringify([
                  key,
                  finding.source_namespace,
                  finding.source_record_id,
                ]),
              )
              .digest("hex");
          records.set(name, {
            ...finding,
            replacement_value:
              finding.type === "correction" ? finding.replacement_value : null,
            evidence: finding.evidence ?? null,
            subject_kind: kind,
            subject_id: identityValue,
            producer_namespace: "intake",
            producer_record_id: name,
            status: "active",
          });
        }
      }
    };
    const urlOwners = new Map<string, { owner: string; sourceKey: string }>();
    for (const kind of RECORD_KINDS_IN_DEPENDENCY_ORDER) {
      const facades = this.facadesByKind.get(kind);
      if (facades === undefined) {
        continue;
      }
      const identityColumn = identityColumnForKind(kind);
      // Lone identities drain concurrently (the common case). Recurring identities
      // converge in order, each recording its row so the next reads it (create, then
      // update|read, last-wins).
      const groups = new Map<string, RegistryFacade[]>();
      const identifiedFacades = await resolveInBatches(
        facades,
        async ([sourceKey, facade]) => {
          const identity = String(await facade.value(identityColumn));
          return { identity, facade, sourceKey };
        },
      );
      const columns = BUSINESS_KEYS[kind];
      if (columns !== undefined) {
        const owners = new Map<
          string,
          { identity: string; sourceKey: string }
        >();
        for (const item of identifiedFacades) {
          const values = await Promise.all(
            columns.map((column) => item.facade.value(column)),
          );
          // SQL unique constraints permit multiple rows with NULL key values.
          if (values.some((value) => value === null || value === undefined))
            continue;
          const key = JSON.stringify(values);
          const owner = owners.get(key);
          if (owner !== undefined && owner.identity !== item.identity) {
            throw new Error(
              `Duplicate ${kind} ${columns.join(", ")} ${key}: ${owner.sourceKey} and ${item.sourceKey}.`,
            );
          }
          owners.set(key, item);
        }
      }
      const urlOwnership = urlOwnershipForKind(kind);
      if (urlOwnership !== undefined) {
        for (const item of identifiedFacades) {
          const url = String(await item.facade.value(urlOwnership.property));
          const owner = String(await item.facade.value(urlOwnership.owner));
          const existing = urlOwners.get(url);
          if (existing !== undefined && existing.owner !== owner) {
            throw new Error(
              `URL ${url} is already owned by ${existing.sourceKey}; conflicting owner ${item.sourceKey}.`,
            );
          }
          urlOwners.set(url, { owner, sourceKey: item.sourceKey });
        }
      }
      // Batches preserve registration order; lookup completion order must
      // not decide which source's values win for a shared identity.
      for (const { identity, facade } of identifiedFacades) {
        const group = groups.get(identity);
        if (group === undefined) {
          groups.set(identity, [facade]);
        } else {
          group.push(facade);
        }
      }

      const singles: RegistryFacade[] = [];
      const recurring: RegistryFacade[][] = [];
      for (const group of groups.values()) {
        if (group.length === 1) {
          singles.push(group[0]!);
        } else {
          recurring.push(group);
        }
      }

      // A single kind can hold >100k rows (tcole assignments); spreading that into
      // push() arguments overflows the call stack, so append in place.
      // Drain one batch at a time so the caller can discard check-only
      // updates before another batch is allocated. Keep registration order.
      for (let offset = 0; offset < singles.length; offset += 1000) {
        const batch = await Promise.all(
          singles.slice(offset, offset + 1000).map(async (facade) => {
            const mutation = await facade.toMutation();
            await inspectFacade(kind, facade);
            return mutation;
          }),
        );
        for (const mutation of batch) visit(mutation);
      }

      for (const group of recurring) {
        for (const facade of group) {
          visit(await facade.toMutation());
          await inspectFacade(kind, facade);
          const { identityValue, resolved } = await facade.resolvedRow();
          this.emittedRows.set(
            DataContext.emittedKey(kind, identityValue),
            facade.inspectionValues,
          );
        }
      }
    }
    const annotationRecords = new Map(
      [...recordsByScope.values()].flatMap((records) => [...records]),
    );
    for (const existing of existingAnnotations) {
      const name = String(existing.producer_record_id);
      const scope = name.split("/")[0] + "/";
      if (
        !annotationScopes.has(scope) ||
        annotationRecords.has(name) ||
        existing.status !== "active"
      )
        continue;
      if (
        existing.type === "correction" &&
        !correctionFieldsByScope.get(scope)?.has(String(existing.field))
      )
        continue;
      annotationRecords.set(name, { ...existing, status: "resolved" });
    }
    for (const [name, spec] of annotationRecords) {
      const facade = this.facadeFromSource("DataAnnotation", {
        apiVersion: INTAKE_API_VERSION,
        namespace: "intake",
        name,
        spec,
      });
      visit(await facade.toMutation());
    }
  }

  async toDatabaseMutationItems(): Promise<DatabaseMutationItem[]> {
    const mutations: DatabaseMutationEnvelope[] = [];
    await this.visitMutations((mutation) => {
      if (!isCheckOnlyUpdateItem(mutation)) mutations.push(mutation);
    });
    // Every facade has been drained into `mutations` (FK values already resolved
    // to primitives), so the facade graph is dead weight. A large source holds
    // hundreds of thousands of facades, each with its property caches — release
    // them before the sort so the plan does not run alongside them.
    this.facadesByKind.clear();
    return planDatabaseMutationItems(mutations);
  }

  async toDatabaseMutations(
    metadata: DatabaseMutationsMetadataInput,
  ): Promise<DatabaseMutationsEnvelope> {
    // build (not new): skip validating the whole mutations array — a source can
    // emit hundreds of thousands of rows, and the write validates every mutation
    // once, per chunk. See DatabaseMutations.buildDatabaseMutations.
    return DatabaseMutations.build({
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
