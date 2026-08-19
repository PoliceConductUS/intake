import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  createCensusAgencyCoordinateResolver,
  createCensusLocationAdministrativeAreaResolver,
} from "./agency-coordinate-resolver.js";
import type { PlanDatabaseMutationsResult } from "./plan-database-mutations.js";
import {
  type AgencyCoordinateRequest,
  type AgencyCoordinateResolution,
  planDatabaseMutations,
  DatabaseMutationPlanningError,
} from "./plan-database-mutations.js";
import {
  defaultDatabaseClientFactory,
  type DatabaseClient,
  type DatabaseClientFactory,
} from "../../database/index.js";
import {
  readDatabaseRecordByColumn,
  readDatabaseRecordsByIds,
} from "../../database/entities.js";
import type {
  LocationAdministrativeAreaRequest,
  LocationAdministrativeAreaResolution,
} from "./data-context.js";
import { writeAgencyCoordinateResolutionCache } from "./agency-coordinate-cache.js";
import { DataContext } from "./data-context.js";
import type { ApplyArtifactMutationResult } from "./artifact-mutation.js";
import { applyOptionalArtifactMutation } from "./artifact-mutation.js";
import {
  Artifacts,
  type ArtifactsEnvelope,
} from "../../../shared/io/Artifacts.js";
import {
  LocationPathGeometries,
  LocationPathGeometry,
} from "../../../shared/io/index.js";
import { assertNoExistingImport } from "./existing-import.js";
import {
  DatabaseMutations,
  type DatabaseMutationItem,
} from "./io/DatabaseMutations.js";
import { LocationPathGeometryCreate } from "./io/generated-mutations/LocationPathGeometryCreate.js";
import { LocationPathGeometryRead } from "./io/generated-mutations/LocationPathGeometryRead.js";
import {
  countDatabaseMutations,
  type DatabaseMutationCounts,
} from "./io/DatabaseMutationCounts.js";
import {
  DatabaseMutationsDebug,
  type DatabaseMutationsDebugInput,
} from "./io/DatabaseMutationsDebug.js";
import {
  createSourceNameToCanonicalIdLedger,
  type LedgerEntityKind,
  type SourceNameToCanonicalIdLedger,
} from "../../state/source-name-to-canonical-id/index.js";
import {
  readResolvedProperty,
  type ResolvedPropertyCacheInput,
  typedInputFingerprint,
  writeResolvedProperty,
} from "../../state/resolved-property/index.js";
import { replayDatabaseMutations } from "../../replay/database-mutations/config.js";
import type { ImportRows, ResolvedProperties } from "./transform.js";
import { transformArtifacts } from "./transform.js";
import {
  IMPORT_ARTIFACT_KINDS,
  INTAKE_API_VERSION,
  sourceNameForImportRecord,
} from "../../../shared/io/import-types.js";
import { importTypeMetadata } from "../../../shared/io/import-type-metadata.js";
import type { ExcludedRecords } from "../../../shared/io/excluded-records.js";

type ImportLogger = {
  debug(object: Record<string, unknown>, message: string): void;
  info(message: string): void;
  info(object: Record<string, unknown>, message: string): void;
  warn?(object: Record<string, unknown>, message: string): void;
  error?(object: Record<string, unknown>, message: string): void;
};

export type ImportArtifactsResult =
  | { ok: true; counts: DatabaseMutationCounts }
  | { ok: false; error: string };

export type ImportArtifactsCommandInput = {
  artifactsPath: string;
  env?: Record<string, string | undefined>;
  dryImport?: boolean;
  logger?: ImportLogger;
  resolveAgencyCoordinates?: (
    requests: AgencyCoordinateRequest[],
  ) => Promise<AgencyCoordinateResolution[]>;
  resolveLocationAdministrativeArea?: (
    request: LocationAdministrativeAreaRequest,
  ) => Promise<LocationAdministrativeAreaResolution | undefined>;
  excludedRecords?: ExcludedRecords;
  commandDirectory?: string;
  commandName?: string;
  clientFactory?: DatabaseClientFactory;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function workspaceRootFromEnv(
  env: Record<string, string | undefined> | undefined,
): string | undefined {
  return env?.INTAKE_WORKSPACE_TEST ?? env?.INTAKE_WORKSPACE;
}

function valueAsRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error("Artifacts agency record must be an object.");
}

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

function slugSourceInput(
  kind: "Agency" | "Personnel",
  record: unknown,
): Record<string, unknown> {
  const spec = valueAsRecord(record);
  if (kind === "Agency") {
    return {
      name: valueAsString(spec.name) ?? null,
    };
  }

  return {
    firstName: valueAsString(spec.first_name) ?? null,
    middleName: valueAsString(spec.middle_name) ?? null,
    lastName: valueAsString(spec.last_name) ?? null,
    prefix: valueAsString(spec.prefix) ?? null,
    suffix: valueAsString(spec.suffix) ?? null,
  };
}

function slugCacheInput(input: {
  namespace: string;
  kind: "Agency" | "Personnel";
  sourceName: string;
  canonicalId: string;
  sourceInput: Record<string, unknown>;
}): ResolvedPropertyCacheInput {
  return {
    subject: {
      apiVersion: INTAKE_API_VERSION,
      kind: input.kind,
      name: input.canonicalId,
    },
    targetProperty: "slug",
    source: {
      namespace: input.namespace,
      kind: input.kind,
      name: input.sourceName,
      inputFingerprint: typedInputFingerprint(input.sourceInput),
    },
  };
}

async function hydrateResolvedSlug(
  context: ImportArtifactsPipelineContext,
  input: {
    resolvedProperties: ResolvedProperties;
    collection: "agencies" | "personnel";
    kind: "Agency" | "Personnel";
    sourceName: string;
    canonicalId: string;
    sourceInput: Record<string, unknown>;
  },
): Promise<void> {
  if (context.artifacts === undefined) {
    throw new Error("Artifacts must be read before hydrating resolved slugs.");
  }

  const slug = await readResolvedProperty({
    ...slugCacheInput({
      namespace: context.artifacts.metadata.namespace,
      kind: input.kind,
      sourceName: input.sourceName,
      canonicalId: input.canonicalId,
      sourceInput: input.sourceInput,
    }),
    rootDir: context.workspaceRoot,
  });
  if (typeof slug !== "string" || slug.trim().length === 0) {
    return;
  }

  input.resolvedProperties[input.collection][input.canonicalId] ??= {};
  input.resolvedProperties[input.collection][input.canonicalId]!.slug = slug;
}

async function hydrateResolvedSlugs(
  context: ImportArtifactsPipelineContext,
): Promise<ResolvedProperties> {
  if (context.artifacts === undefined) {
    throw new Error(
      "Artifacts must be loaded before hydrating resolved slugs.",
    );
  }

  const namespace = context.artifacts.metadata.namespace;
  const resolvedProperties: ResolvedProperties = {
    agencies: {},
    personnel: {},
  };
  // Personnel slugs are owned by the PersonnelFacade's generate-unique resolver
  // (ADR 0016) and reused from the database for stability, so only agency slugs
  // are hydrated from the durable cache here. The agency id is find-or-created
  // (its stable Identity Map id), keyed on the slug cache.
  for (const artifact of context.artifacts.spec.artifacts) {
    if (artifact.kind !== "Agencies") {
      continue;
    }
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      const sourceName = sourceNameForImportRecord(recordName, record);
      const canonicalId = await context.ledger.findOrCreate(
        namespace,
        "Agency",
        sourceName,
      );
      await hydrateResolvedSlug(context, {
        resolvedProperties,
        collection: "agencies",
        kind: "Agency",
        sourceName,
        canonicalId,
        sourceInput: slugSourceInput("Agency", record),
      });
    }
  }

  return resolvedProperties;
}

async function persistResolvedSlugs(
  context: ImportArtifactsPipelineContext,
): Promise<void> {
  if (context.artifacts === undefined || context.rows === undefined) {
    throw new Error(
      "Artifacts and rows must be available before persisting resolved slugs.",
    );
  }

  const namespace = context.artifacts.metadata.namespace;
  // Personnel slugs are owned by the PersonnelFacade's generate-unique resolver
  // (ADR 0016), which reuses an existing DB slug for stability; they are no
  // longer cached here. Only agency slugs remain row-based.
  const agencyById = new Map(
    context.rows.agencies.map((agency) => [agency.id, agency]),
  );
  let cachedSlugs = 0;
  for (const artifact of context.artifacts.spec.artifacts) {
    if (artifact.kind !== "Agencies") {
      continue;
    }
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      const sourceName = sourceNameForImportRecord(recordName, record);
      const canonicalId = await context.ledger.findOrCreate(
        namespace,
        "Agency",
        sourceName,
      );
      const slug = agencyById.get(canonicalId)?.slug;
      if (typeof slug !== "string" || slug.trim().length === 0) {
        continue;
      }

      await writeResolvedProperty({
        ...slugCacheInput({
          namespace: context.artifacts.metadata.namespace,
          kind: "Agency",
          sourceName,
          canonicalId,
          sourceInput: slugSourceInput("Agency", record),
        }),
        rootDir: context.workspaceRoot,
        value: slug,
      });
      cachedSlugs += 1;
    }
  }

  if (cachedSlugs > 0) {
    context.commandInput.logger?.info(
      { cachedSlugs },
      `Cached ${cachedSlugs} agency/personnel slug ${cachedSlugs === 1 ? "resolution" : "resolutions"}.`,
    );
  }
}

function addPersonnelSourceFacades(
  dataContext: DataContext,
  artifacts: ArtifactsEnvelope,
): void {
  // Route each Personnel source record through its facade (ADR 0016). The
  // facade's resolvers derive the canonical id (ledger find-or-create) and a
  // unique slug (generate-unique), then `toMutation` emits the create or update.
  // No prepared transform row is involved.
  for (const artifact of artifacts.spec.artifacts.filter(
    (item) => item.kind === "Personnel",
  )) {
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      const sourceName = sourceNameForImportRecord(recordName, record);
      dataContext.personnelFromSource({
        apiVersion: INTAKE_API_VERSION,
        namespace: artifacts.metadata.namespace,
        name: sourceName,
        spec: valueAsRecord(record),
        sourceFile: artifact.recordSources?.[recordName],
      });
    }
  }
}

async function addAgencyPersonnelSourceFacades(
  dataContext: DataContext,
  artifacts: ArtifactsEnvelope,
  rows: ImportRows,
  ledger: SourceNameToCanonicalIdLedger,
): Promise<void> {
  // Route each AgencyPersonnel source record through its facade (ADR 0016). The
  // facade's resolvers derive the canonical id and the agency / personnel /
  // license foreign keys (same-source finds against the source values in the
  // raw record), then `toMutation` emits the create or update.
  //
  // COEXISTENCE: the excluded-agency cascade (drop dependent agency_officers)
  // still runs on `rows.agencyOfficers` in plan-database-mutations; a record
  // whose canonical id is no longer among the surviving rows was cascaded out
  // (its agency was excluded), so it is skipped here — otherwise its Agency FK
  // find would fail loud on the (correctly) absent Agency facade.
  const survivingAgencyPersonnelIds = new Set(
    rows.agencyOfficers.map((agencyPersonnel) => agencyPersonnel.id),
  );

  for (const artifact of artifacts.spec.artifacts.filter(
    (item) => item.kind === "AgencyPersonnel",
  )) {
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      const sourceName = sourceNameForImportRecord(recordName, record);
      const canonicalId = await ledger.read(
        artifacts.metadata.namespace,
        "AgencyPersonnel",
        sourceName,
      );
      if (
        canonicalId === undefined ||
        !survivingAgencyPersonnelIds.has(canonicalId)
      ) {
        continue;
      }

      dataContext.agencyPersonnelFromSource({
        apiVersion: INTAKE_API_VERSION,
        namespace: artifacts.metadata.namespace,
        name: sourceName,
        spec: valueAsRecord(record),
        sourceFile: artifact.recordSources?.[recordName],
      });
    }
  }
}

function addLicensingAuthoritySourceFacades(
  dataContext: DataContext,
  artifacts: ArtifactsEnvelope,
): void {
  // Route each LicensingAuthority source record through its facade (ADR 0016).
  // The facade's resolvers derive the canonical id (ledger find-or-create) and
  // the location_path_id (resolve-or-fail), then `toMutation` emits the create
  // or update. No prepared transform row is involved.
  for (const artifact of artifacts.spec.artifacts.filter(
    (item) => item.kind === "LicensingAuthorities",
  )) {
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      const sourceName = sourceNameForImportRecord(recordName, record);
      dataContext.licensingAuthorityFromSource({
        apiVersion: INTAKE_API_VERSION,
        namespace: artifacts.metadata.namespace,
        name: sourceName,
        spec: valueAsRecord(record),
        sourceFile: artifact.recordSources?.[recordName],
      });
    }
  }
}

function addLicenseSourceFacades(
  dataContext: DataContext,
  artifacts: ArtifactsEnvelope,
): void {
  // Route each License source record through its facade (ADR 0016). The facade's
  // resolvers derive the canonical id (ledger find-or-create) and the officer /
  // licensing-authority foreign keys (same-source finds), then `toMutation`
  // emits the create or update. No prepared transform row is involved.
  for (const artifact of artifacts.spec.artifacts.filter(
    (item) => item.kind === "Licenses",
  )) {
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      const sourceName = sourceNameForImportRecord(recordName, record);
      dataContext.licenseFromSource({
        apiVersion: INTAKE_API_VERSION,
        namespace: artifacts.metadata.namespace,
        name: sourceName,
        spec: valueAsRecord(record),
        sourceFile: artifact.recordSources?.[recordName],
      });
    }
  }
}

function addLicenseActionSourceFacades(
  dataContext: DataContext,
  artifacts: ArtifactsEnvelope,
): void {
  // Route each LicenseAction source record through its facade (ADR 0016). The
  // facade resolves its canonical id and its license foreign key (same-source
  // find) before emitting the create or update.
  for (const artifact of artifacts.spec.artifacts.filter(
    (item) => item.kind === "LicenseActions",
  )) {
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      const sourceName = sourceNameForImportRecord(recordName, record);
      dataContext.licenseActionFromSource({
        apiVersion: INTAKE_API_VERSION,
        namespace: artifacts.metadata.namespace,
        name: sourceName,
        spec: valueAsRecord(record),
        sourceFile: artifact.recordSources?.[recordName],
      });
    }
  }
}

function addDisciplineSourceFacades(
  dataContext: DataContext,
  artifacts: ArtifactsEnvelope,
): void {
  for (const artifact of artifacts.spec.artifacts.filter(
    (item) => item.kind === "Disciplines",
  )) {
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      dataContext.disciplineFromSource({
        apiVersion: INTAKE_API_VERSION,
        namespace: artifacts.metadata.namespace,
        name: sourceNameForImportRecord(recordName, record),
        spec: valueAsRecord(record),
        sourceFile: artifact.recordSources?.[recordName],
      });
    }
  }
}

function addDisciplineAgencyOfficerSourceFacades(
  dataContext: DataContext,
  artifacts: ArtifactsEnvelope,
): void {
  for (const artifact of artifacts.spec.artifacts.filter(
    (item) => item.kind === "DisciplineAgencyOfficers",
  )) {
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      dataContext.disciplineAgencyOfficerFromSource({
        apiVersion: INTAKE_API_VERSION,
        namespace: artifacts.metadata.namespace,
        name: sourceNameForImportRecord(recordName, record),
        spec: valueAsRecord(record),
        sourceFile: artifact.recordSources?.[recordName],
      });
    }
  }
}

function addCoverageLinkSourceFacades(
  dataContext: DataContext,
  artifacts: ArtifactsEnvelope,
): void {
  for (const artifact of artifacts.spec.artifacts.filter(
    (item) => item.kind === "CoverageLinks",
  )) {
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      dataContext.coverageLinkFromSource({
        apiVersion: INTAKE_API_VERSION,
        namespace: artifacts.metadata.namespace,
        name: sourceNameForImportRecord(recordName, record),
        spec: valueAsRecord(record),
        sourceFile: artifact.recordSources?.[recordName],
      });
    }
  }
}

function addCoverageLinkAgencyOfficerSourceFacades(
  dataContext: DataContext,
  artifacts: ArtifactsEnvelope,
): void {
  for (const artifact of artifacts.spec.artifacts.filter(
    (item) => item.kind === "CoverageLinkAgencyOfficers",
  )) {
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      dataContext.coverageLinkAgencyOfficerFromSource({
        apiVersion: INTAKE_API_VERSION,
        namespace: artifacts.metadata.namespace,
        name: sourceNameForImportRecord(recordName, record),
        spec: valueAsRecord(record),
        sourceFile: artifact.recordSources?.[recordName],
      });
    }
  }
}

type ImportArtifactsPipelineContext = {
  commandInput: ImportArtifactsCommandInput;
  artifactsPath: string;
  commandName: string;
  workspaceRoot?: string;
  artifacts?: ArtifactsEnvelope;
  artifactMutation?: ApplyArtifactMutationResult;
  ledger: SourceNameToCanonicalIdLedger;
  resolvedProperties?: ResolvedProperties;
  rows?: ImportRows;
  preparationError?: DatabaseMutationPlanningError;
  databaseResult?: PlanDatabaseMutationsResult;
  databaseMutationCounts?: DatabaseMutationCounts;
};

type ImportArtifactsPipelineStage = (
  context: ImportArtifactsPipelineContext,
) => Promise<ImportArtifactsPipelineContext>;

const databaseImportArtifactKinds = IMPORT_ARTIFACT_KINDS.filter(
  (kind) =>
    "targetTable" in importTypeMetadata[kind] ||
    kind === "LocationPathGeometries",
);

const initialReadArtifactKinds = databaseImportArtifactKinds.filter(
  (kind) => kind !== "LocationPathGeometries",
);

async function readArtifactsStage(
  context: ImportArtifactsPipelineContext,
): Promise<ImportArtifactsPipelineContext> {
  context.commandInput.logger?.info("Reading Artifacts.");
  const artifacts = await Artifacts.read(context.artifactsPath, {
    includeKinds: initialReadArtifactKinds,
  });
  context.commandInput.logger?.debug(
    {
      artifactsPath: context.artifactsPath,
      namespace: artifacts.metadata.namespace,
      agencyCount: artifacts.spec.artifacts
        .filter((artifact) => artifact.kind === "Agencies")
        .reduce(
          (count, artifact) =>
            count + Object.keys(artifact.spec.records).length,
          0,
        ),
      personnelCount: artifacts.spec.artifacts
        .filter((artifact) => artifact.kind === "Personnel")
        .reduce(
          (count, artifact) =>
            count + Object.keys(artifact.spec.records).length,
          0,
        ),
      agencyPersonnelCount: artifacts.spec.artifacts
        .filter((artifact) => artifact.kind === "AgencyPersonnel")
        .reduce(
          (count, artifact) =>
            count + Object.keys(artifact.spec.records).length,
          0,
        ),
    },
    "Artifacts loaded.",
  );
  context.commandInput.logger?.info(
    `Artifacts namespace: ${artifacts.metadata.namespace}.`,
  );
  return { ...context, artifacts };
}

async function rejectExistingImportStage(
  context: ImportArtifactsPipelineContext,
): Promise<ImportArtifactsPipelineContext> {
  if (context.artifacts === undefined) {
    throw new Error(
      "Artifacts must be read before checking for existing imports.",
    );
  }

  context.commandInput.logger?.info("Checking for existing DatabaseMutations.");
  await assertNoExistingImport(
    context.artifacts,
    context.commandInput.env === undefined
      ? {}
      : { env: context.commandInput.env },
  );
  return context;
}

async function applyArtifactMutationsStage(
  context: ImportArtifactsPipelineContext,
): Promise<ImportArtifactsPipelineContext> {
  if (context.artifacts === undefined) {
    throw new Error(
      "Artifacts must be read before applying artifact mutations.",
    );
  }

  context.commandInput.logger?.info("Checking for artifact mutations.");
  const artifactMutation = await applyOptionalArtifactMutation(
    context.artifacts,
    {
      artifactsPath: context.artifactsPath,
    },
  );
  if (artifactMutation.applied) {
    context.commandInput.logger?.info(
      { artifactMutationPath: artifactMutation.reference.path },
      "Artifact mutations applied.",
    );
  }
  return { ...context, artifactMutation };
}

async function persistArtifactAgencyCoordinatesStage(
  context: ImportArtifactsPipelineContext,
): Promise<void> {
  if (context.artifacts === undefined) {
    throw new Error(
      "Artifacts must be available before caching agency coordinates.",
    );
  }

  const namespace = context.artifacts.metadata.namespace;
  let cachedCoordinates = 0;
  for (const artifact of context.artifacts.spec.artifacts.filter(
    (item) => item.kind === "Agencies",
  )) {
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      const sourceName = sourceNameForImportRecord(recordName, record);
      const spec = valueAsRecord(record);
      const latitude = valueAsFiniteNumber(spec.latitude);
      const longitude = valueAsFiniteNumber(spec.longitude);
      const name = valueAsString(spec.name);
      const address = valueAsString(spec.address);
      const city = valueAsString(spec.city);
      const state = valueAsString(spec.state);
      const zipCode = valueAsString(spec.zip_code);
      const canonicalId = await context.ledger.findOrCreate(
        namespace,
        "Agency",
        sourceName,
      );
      if (
        latitude === undefined ||
        longitude === undefined ||
        name === undefined ||
        address === undefined ||
        city === undefined ||
        state === undefined ||
        zipCode === undefined
      ) {
        continue;
      }

      await writeAgencyCoordinateResolutionCache(
        {
          rowId: canonicalId,
          sourceName,
          name,
          address,
          city,
          state,
          zipCode,
        },
        {
          rowId: canonicalId,
          latitude,
          longitude,
        },
        {
          sourceNamespace: context.artifacts.metadata.namespace,
          resolvedPropertyCache: {
            write: (input) =>
              writeResolvedProperty({
                ...input,
                rootDir: context.workspaceRoot,
              }),
            read: (input) =>
              readResolvedProperty({
                ...input,
                rootDir: context.workspaceRoot,
              }),
          },
        },
      );
      cachedCoordinates += 1;
    }
  }

  if (cachedCoordinates > 0) {
    context.commandInput.logger?.info(
      { entityType: "agency", cachedCoordinates },
      `Cached ${cachedCoordinates} agency address coordinate ${cachedCoordinates === 1 ? "resolution" : "resolutions"}.`,
    );
  }
}

async function transformArtifactsStage(
  context: ImportArtifactsPipelineContext,
): Promise<ImportArtifactsPipelineContext> {
  if (context.artifacts === undefined) {
    throw new Error("Artifacts must be loaded before transforming artifacts.");
  }

  context.commandInput.logger?.info("Transforming artifact records.");
  const resolvedProperties = await hydrateResolvedSlugs(context);
  const rows = await transformArtifacts(
    context.artifacts,
    context.ledger,
    resolvedProperties,
  );
  context.commandInput.logger?.debug(
    {
      agencies: rows.agencies.length,
      agencyOfficers: rows.agencyOfficers.length,
    },
    "Artifacts transformed.",
  );
  return { ...context, resolvedProperties, rows };
}

async function executeDatabaseMutationPlanningStage(
  context: ImportArtifactsPipelineContext,
): Promise<ImportArtifactsPipelineContext> {
  if (
    context.artifacts === undefined ||
    context.artifactMutation === undefined ||
    context.rows === undefined
  ) {
    throw new Error(
      "Artifacts must be transformed before planning database mutations.",
    );
  }

  context.commandInput.logger?.info("Planning database mutations.");
  try {
    const databaseResult = await planDatabaseMutations(context.rows, {
      resolveAgencyCoordinates:
        context.commandInput.resolveAgencyCoordinates ??
        createCensusAgencyCoordinateResolver(undefined, {
          onProgress: (event) => {
            if (event.stage === "batch") {
              context.commandInput.logger?.info(
                {
                  entityType: "agency",
                  total: event.total,
                },
                `Resolving agency address coordinates for ${event.total} ${event.total === 1 ? "agency" : "agencies"}.`,
              );
              return;
            }

            context.commandInput.logger?.info(
              {
                entityType: "agency",
                attempted: event.attempted,
                total: event.total,
                rowId: event.rowId,
              },
              `Resolving unresolved agency address coordinates (${event.attempted} of ${event.total}).`,
            );
          },
        }),
      resolveLocationAdministrativeArea:
        context.commandInput.resolveLocationAdministrativeArea ??
        createCensusLocationAdministrativeAreaResolver(),
      excludedRecords: context.commandInput.excludedRecords,
      sourceNamespace: context.artifacts.metadata.namespace,
      ledger: context.ledger,
      resolvedProperties: context.resolvedProperties,
      resolvedPropertyCache: {
        read: (input) =>
          readResolvedProperty({ ...input, rootDir: context.workspaceRoot }),
        write: (input) =>
          writeResolvedProperty({ ...input, rootDir: context.workspaceRoot }),
      },
      logger: context.commandInput.logger,
      env: context.commandInput.env,
      clientFactory: context.commandInput.clientFactory,
    });
    await persistResolvedSlugs(context);
    return { ...context, databaseResult };
  } catch (error) {
    if (!(error instanceof DatabaseMutationPlanningError)) {
      throw error;
    }
    return { ...context, preparationError: error };
  }
}

async function writeDatabaseMutationsDebugStage(
  context: ImportArtifactsPipelineContext,
): Promise<ImportArtifactsPipelineContext> {
  if (context.preparationError === undefined) {
    return context;
  }
  if (
    context.artifacts === undefined ||
    context.artifactMutation === undefined
  ) {
    throw new Error(
      "Artifacts must be loaded before writing DatabaseMutationsDebug.",
    );
  }

  context.commandInput.logger?.info(
    "Writing debug DatabaseMutations envelope.",
  );
  if (context.commandInput.commandDirectory === undefined) {
    throw new Error(
      "Command directory is required to write DatabaseMutationsDebug.",
    );
  }
  const error = context.preparationError;
  const dataContext = new DataContext({
    rows: error.rows,
    operations: {
      locationPaths: {},
      locationPathGeometries: {},
      locationPathAliases: {},
      agencies: {},
      officers: {},
      agencyOfficers: {},
      licensingAuthorities: {},
      licenses: {},
      licenseActions: {},
    },
    ledger: context.ledger,
    commandName: context.commandName,
  });
  const envelopeInput: DatabaseMutationsDebugInput = {
    metadata: {
      namespace: context.artifacts.metadata.namespace,
      name: context.commandName,
      sourceArtifactsName: context.artifacts.metadata.name,
      sourceArtifactsPath: context.artifactsPath,
      sourceArtifactsDigest: await Artifacts.digest(context.artifactsPath),
      databaseSchema: error.schema,
      ...(context.artifactMutation.applied
        ? { artifactMutation: context.artifactMutation.reference }
        : {}),
      status: "failed",
      counts: {
        locationPaths: error.rows.locationPaths.length,
        locationPathGeometries: error.rows.locationPathGeometries?.length ?? 0,
        locationPathAliases: error.rows.locationPathAliases.length,
        agencies: error.rows.agencies.length,
        // Personnel is facade-based (ADR 0016) and counted from the emitted
        // envelope, not from transform rows.
        agencyPersonnel: error.rows.agencyOfficers.length,
      },
      errors: [...error.errors],
      preparationMutations: [...error.rows.preparationMutations],
    },
    spec: { mutations: await dataContext.toDatabaseMutationItems() },
  };
  await mkdir(context.commandInput.commandDirectory, { recursive: true });
  const databaseMutationsEnvelope = await DatabaseMutationsDebug.write(
    context.commandInput.commandDirectory,
    DatabaseMutationsDebug.new(envelopeInput),
  );
  context.commandInput.logger?.info(
    { databaseMutationsPath: databaseMutationsEnvelope.path },
    "Debug DatabaseMutations envelope written.",
  );
  throw error;
}

type RawLocationPathGeometryArtifact = {
  metadata: { namespace: string };
  spec: {
    records: Record<
      string,
      | { spec: Record<string, unknown> }
      | { ref: { path: string; kind: "LocationPathGeometry"; sha256?: string } }
    >;
  };
};

type StreamingGeometryRecord = {
  recordKey: string;
  spec: Record<string, unknown>;
};

function resolveRelativeArtifactPath(
  artifactsPath: string,
  artifactPath: string,
): string {
  return path.resolve(path.dirname(artifactsPath), artifactPath);
}

async function* readLocationPathGeometryRecords(
  artifactsPath: string,
  namespace: string,
): AsyncGenerator<StreamingGeometryRecord> {
  const artifacts = await Artifacts.read(artifactsPath, { raw: true });
  for (const artifactItem of artifacts.spec.artifacts) {
    if (
      ("ref" in artifactItem ? artifactItem.ref.kind : artifactItem.kind) !==
      "LocationPathGeometries"
    ) {
      continue;
    }

    const artifactPath =
      "ref" in artifactItem
        ? resolveRelativeArtifactPath(artifactsPath, artifactItem.ref.path)
        : artifactsPath;
    const artifact = (
      "ref" in artifactItem
        ? await LocationPathGeometries.read(artifactPath, {
            expectedKind: "LocationPathGeometries",
            expectedNamespace: namespace,
            expectedSha256: artifactItem.ref.sha256,
            raw: true,
          })
        : {
            metadata: {
              name: artifacts.metadata.name,
              namespace: artifacts.metadata.namespace,
            },
            spec: artifactItem.spec,
          }
    ) as RawLocationPathGeometryArtifact;

    for (const [recordKey, recordItem] of Object.entries(
      artifact.spec.records,
    )) {
      if ("ref" in recordItem) {
        const record = await LocationPathGeometry.read(recordItem.ref, {
          relativeTo: artifactPath,
          expectedNamespace: artifact.metadata.namespace,
        });
        if (record.metadata.name !== recordKey) {
          throw new Error(
            `LocationPathGeometries record metadata.name ${record.metadata.name} does not match expected record key ${recordKey}: ${artifactPath}`,
          );
        }
        yield { recordKey, spec: record.spec as Record<string, unknown> };
        continue;
      }

      yield { recordKey, spec: recordItem.spec };
    }
  }
}

function requiredStreamingString(
  recordKey: string,
  fieldName: string,
  value: unknown,
): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  throw new Error(
    `Artifacts location path geometry ${recordKey} is missing required field ${fieldName}.`,
  );
}

async function canonicalLocationPathIdForGeometry(
  recordKey: string,
  spec: Record<string, unknown>,
  namespace: string,
  ledger: SourceNameToCanonicalIdLedger,
): Promise<{ canonicalId: string; sourceLocationPathKey: string }> {
  const sourceLocationPathKey = requiredStreamingString(
    recordKey,
    "sourceLocationPathKey",
    spec.sourceLocationPathKey,
  );
  const sourceLocationPathId =
    typeof spec.location_path_id === "string" &&
    spec.location_path_id.trim().length > 0
      ? spec.location_path_id
      : undefined;
  // A geometry must reference an already-recorded location path; try the known
  // source-key candidates and fail loud when none resolves.
  for (const candidate of [
    sourceLocationPathKey,
    sourceLocationPathId,
    recordKey,
  ]) {
    if (candidate === undefined) {
      continue;
    }
    const canonicalId = await ledger.read(namespace, "LocationPath", candidate);
    if (canonicalId !== undefined && canonicalId.trim().length > 0) {
      return { canonicalId, sourceLocationPathKey };
    }
  }

  throw new Error(
    `Artifacts location path geometry ${recordKey} references unmapped location path ${sourceLocationPathKey}.`,
  );
}

async function writeLocationPathGeometryMutationRefs(
  context: ImportArtifactsPipelineContext,
  client: DatabaseClient,
): Promise<DatabaseMutationItem[]> {
  if (
    context.artifacts === undefined ||
    context.commandInput.commandDirectory === undefined
  ) {
    throw new Error(
      "Artifacts and command directory are required to write LocationPathGeometry mutations.",
    );
  }

  const mutationDirectory = path.join(
    context.commandInput.commandDirectory,
    `${context.commandName}.DatabaseMutations.records`,
  );
  await mkdir(mutationDirectory, { recursive: true });

  const mutations: DatabaseMutationItem[] = [];
  let processed = 0;
  for await (const { recordKey, spec } of readLocationPathGeometryRecords(
    context.artifactsPath,
    context.artifacts.metadata.namespace,
  )) {
    const { canonicalId, sourceLocationPathKey } =
      await canonicalLocationPathIdForGeometry(
        recordKey,
        spec,
        context.artifacts.metadata.namespace,
        context.ledger,
      );

    const existing = await readDatabaseRecordByColumn(
      client,
      "public.location_path_geometry",
      "location_path_id",
      canonicalId,
    );
    const written =
      existing === undefined
        ? await LocationPathGeometryCreate.write(
            mutationDirectory,
            LocationPathGeometryCreate.new({
              metadata: {
                name: canonicalId,
                namespace: context.artifacts.metadata.namespace,
              },
              spec: {
                ...spec,
                location_path_id: canonicalId,
                sourceLocationPathKey,
              } as Parameters<typeof LocationPathGeometryCreate.new>[0]["spec"],
            }),
          )
        : await LocationPathGeometryRead.write(
            mutationDirectory,
            LocationPathGeometryRead.new({
              metadata: {
                name: canonicalId,
                namespace: context.artifacts.metadata.namespace,
              },
              spec: {},
            }),
          );

    mutations.push({
      ref: {
        path: path.relative(
          context.commandInput.commandDirectory,
          written.path,
        ),
        kind:
          existing === undefined
            ? "LocationPathGeometryCreate"
            : "LocationPathGeometryRead",
      },
    });

    processed += 1;
    if (processed % 1000 === 0) {
      context.commandInput.logger?.info(
        { entityType: "LocationPathGeometry", processed },
        `Prepared ${processed} location path geometry mutations.`,
      );
    }
  }

  if (processed > 0) {
    context.commandInput.logger?.info(
      { entityType: "LocationPathGeometry", processed },
      `Prepared ${processed} location path geometry mutations.`,
    );
  }

  return mutations;
}

async function appendStreamingLocationPathGeometryMutations(
  context: ImportArtifactsPipelineContext,
  mutations: DatabaseMutationItem[],
): Promise<DatabaseMutationItem[]> {
  const databaseUrl = (context.commandInput.env ?? process.env).DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error(
      "DATABASE_URL is required to plan location path geometry mutations.",
    );
  }

  const client = (
    context.commandInput.clientFactory ?? defaultDatabaseClientFactory
  )(databaseUrl);
  try {
    await client.connect();
    const geometryMutations = await writeLocationPathGeometryMutationRefs(
      context,
      client,
    );
    return [...mutations, ...geometryMutations];
  } finally {
    await client.end();
  }
}

async function writeDatabaseMutationsStage(
  context: ImportArtifactsPipelineContext,
): Promise<ImportArtifactsPipelineContext> {
  if (
    context.artifacts === undefined ||
    context.artifactMutation === undefined ||
    context.rows === undefined ||
    context.databaseResult === undefined
  ) {
    throw new Error("DatabaseMutations must be prepared before writing.");
  }
  const namespace = context.artifacts.metadata.namespace;
  const artifacts = context.artifacts;
  const ledger = context.ledger;

  context.commandInput.logger?.info("Writing DatabaseMutations envelope.");
  if (context.commandInput.commandDirectory === undefined) {
    throw new Error(
      "Command directory is required to write DatabaseMutations.",
    );
  }
  // The LicensingAuthority location_path resolver reaches the backend
  // (resolve-or-fail, ADR 0006/0015); the License / LicenseAction facades load
  // existing rows to decide create-vs-update; and the Personnel facade checks the
  // database for slug uniqueness and loads existing officers for create-vs-update.
  // Give the DataContext a database client when any of these facade-based entities
  // exist.
  const facadeEntityKinds = [
    "Personnel",
    "AgencyPersonnel",
    "LicensingAuthorities",
    "Licenses",
    "LicenseActions",
  ] as const;
  const hasFacadeEntities = context.artifacts.spec.artifacts.some(
    (artifact) =>
      (facadeEntityKinds as readonly string[]).includes(artifact.kind) &&
      Object.keys(artifact.spec.records).length > 0,
  );
  let facadeBackendClient: DatabaseClient | undefined;
  if (hasFacadeEntities) {
    const databaseUrl = (context.commandInput.env ?? process.env).DATABASE_URL;
    if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
      throw new Error(
        "DATABASE_URL is required to resolve licensing authority, license, and license action mutations.",
      );
    }
    facadeBackendClient = (
      context.commandInput.clientFactory ?? defaultDatabaseClientFactory
    )(databaseUrl);
    await facadeBackendClient.connect();
  }

  // The canonical ids for a facade entity kind, derived by find-or-create over
  // its in-memory artifact records — the same ids the facades will resolve, so
  // the DB preload below matches. (Enumerating the ledger directory is exactly
  // the bulk scan we removed.)
  const canonicalIdsForKind = async (
    artifactKind: string,
    ledgerKind: LedgerEntityKind,
  ): Promise<string[]> => {
    const ids: string[] = [];
    for (const artifact of artifacts.spec.artifacts) {
      if (artifact.kind !== artifactKind) {
        continue;
      }
      for (const [recordName, record] of Object.entries(
        artifact.spec.records,
      )) {
        ids.push(
          await ledger.findOrCreate(
            namespace,
            ledgerKind,
            sourceNameForImportRecord(recordName, record),
          ),
        );
      }
    }
    return ids;
  };

  // Load the already-existing `public.officers` / `public.agency_officers` /
  // `public.licensing_authority` / `public.license` / `public.license_action`
  // rows for those canonical ids so each facade auto-loads `current` and emits
  // an update (not a duplicate create) on re-import — mirroring how agencies are
  // loaded via databaseAgencies.
  const databaseOfficers =
    facadeBackendClient === undefined
      ? []
      : await readDatabaseRecordsByIds(
          facadeBackendClient,
          "public.officers",
          await canonicalIdsForKind("Personnel", "Personnel"),
        );
  const databaseAgencyPersonnel =
    facadeBackendClient === undefined
      ? []
      : await readDatabaseRecordsByIds(
          facadeBackendClient,
          "public.agency_officers",
          await canonicalIdsForKind("AgencyPersonnel", "AgencyPersonnel"),
        );
  const databaseLicensingAuthorities =
    facadeBackendClient === undefined
      ? []
      : await readDatabaseRecordsByIds(
          facadeBackendClient,
          "public.licensing_authority",
          await canonicalIdsForKind(
            "LicensingAuthorities",
            "LicensingAuthority",
          ),
        );
  const databaseLicenses =
    facadeBackendClient === undefined
      ? []
      : await readDatabaseRecordsByIds(
          facadeBackendClient,
          "public.license",
          await canonicalIdsForKind("Licenses", "License"),
        );
  const databaseLicenseActions =
    facadeBackendClient === undefined
      ? []
      : await readDatabaseRecordsByIds(
          facadeBackendClient,
          "public.license_action",
          await canonicalIdsForKind("LicenseActions", "LicenseAction"),
        );

  let databaseMutations;
  try {
    const dataContext = new DataContext({
      rows: context.rows,
      operations: context.databaseResult.operations,
      // The canonical-id resolvers find-or-create each entity's own id through
      // the ledger's per-record file read/write (ADR 0016 #4).
      ledger,
      commandName: context.commandName,
      // Must match the preparation pass on which agencies already exist, so an
      // existing agency is written as an update (not a create missing a slug).
      databaseAgencies: context.databaseResult.databaseAgencies,
      databaseOfficers,
      databaseAgencyPersonnel,
      databaseLicensingAuthorities,
      databaseLicenses,
      databaseLicenseActions,
      ...(facadeBackendClient === undefined
        ? {}
        : { client: facadeBackendClient }),
    });
    dataContext.mergeAgencyArtifacts(context.artifacts);
    // Add facades in dependency order so every same-source FK find (ADR 0016
    // #4/#9) targets an already-registered facade: LicensingAuthorities and
    // Personnel before Licenses, Licenses before LicenseActions. Agencies and
    // AgencyPersonnel are unaffected.
    addLicensingAuthoritySourceFacades(dataContext, context.artifacts);
    addPersonnelSourceFacades(dataContext, context.artifacts);
    addLicenseSourceFacades(dataContext, context.artifacts);
    addLicenseActionSourceFacades(dataContext, context.artifacts);
    await addAgencyPersonnelSourceFacades(
      dataContext,
      context.artifacts,
      context.rows,
      ledger,
    );
    addDisciplineSourceFacades(dataContext, context.artifacts);
    addDisciplineAgencyOfficerSourceFacades(dataContext, context.artifacts);
    addCoverageLinkSourceFacades(dataContext, context.artifacts);
    addCoverageLinkAgencyOfficerSourceFacades(dataContext, context.artifacts);
    databaseMutations = await dataContext.toDatabaseMutations({
      namespace: context.artifacts.metadata.namespace,
      name: context.commandName,
      sourceArtifactsName: context.artifacts.metadata.name,
      sourceArtifactsPath: context.artifactsPath,
      sourceArtifactsDigest: await Artifacts.digest(context.artifactsPath),
      databaseSchema: context.databaseResult.schema,
      ...(context.artifactMutation.applied
        ? { artifactMutation: context.artifactMutation.reference }
        : {}),
    });
  } finally {
    if (facadeBackendClient !== undefined) {
      await facadeBackendClient.end();
    }
  }
  await mkdir(context.commandInput.commandDirectory, { recursive: true });
  databaseMutations.spec.mutations =
    await appendStreamingLocationPathGeometryMutations(
      context,
      databaseMutations.spec.mutations,
    );
  const databaseMutationsEnvelope = await DatabaseMutations.write(
    context.commandInput.commandDirectory,
    databaseMutations,
  );
  const databaseMutationCounts = countDatabaseMutations(
    databaseMutations.spec.mutations,
  );
  context.commandInput.logger?.info(
    { databaseMutationsPath: databaseMutationsEnvelope.path },
    "DatabaseMutations envelope written.",
  );
  context.commandInput.logger?.info(
    context.commandInput.dryImport === true
      ? "Dry run enabled; database create/read/update skipped."
      : "Applying DatabaseMutations envelope.",
  );
  if (context.commandInput.dryImport === true) {
    return { ...context, databaseMutationCounts };
  }

  const replayResult = await replayDatabaseMutations({
    databaseMutationsPath: databaseMutationsEnvelope.path,
    env: context.commandInput.env,
    clientFactory: context.commandInput.clientFactory,
  });
  if (!replayResult.ok) {
    throw new Error(replayResult.error);
  }
  context.commandInput.logger?.info("Database records created/read/updated.");
  return {
    ...context,
    databaseMutationCounts: replayResult.counts,
  };
}

const importArtifactsPipelineStages: ImportArtifactsPipelineStage[] = [
  readArtifactsStage,
  rejectExistingImportStage,
  applyArtifactMutationsStage,
  async (context) => {
    await persistArtifactAgencyCoordinatesStage(context);
    return context;
  },
  transformArtifactsStage,
  executeDatabaseMutationPlanningStage,
  writeDatabaseMutationsDebugStage,
  writeDatabaseMutationsStage,
];

export async function importArtifacts(
  commandInput: ImportArtifactsCommandInput,
): Promise<ImportArtifactsResult> {
  try {
    if (
      commandInput.commandName === undefined ||
      commandInput.commandName.trim().length === 0
    ) {
      throw new Error("Command name is required to import artifacts.");
    }

    const workspaceRoot = workspaceRootFromEnv(commandInput.env);
    let context: ImportArtifactsPipelineContext = {
      commandInput,
      artifactsPath: commandInput.artifactsPath,
      commandName: commandInput.commandName,
      workspaceRoot,
      ledger: createSourceNameToCanonicalIdLedger(
        workspaceRoot === undefined ? {} : { rootDir: workspaceRoot },
      ),
    };
    for (const stage of importArtifactsPipelineStages) {
      context = await stage(context);
    }
    if (context.databaseMutationCounts === undefined) {
      throw new Error(
        "DatabaseMutations pipeline finished without mutation counts.",
      );
    }
    return { ok: true, counts: context.databaseMutationCounts };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
