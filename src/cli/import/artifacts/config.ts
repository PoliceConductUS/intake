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
import { readDatabaseRecordByColumn } from "../../database/entities.js";
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
  assertCanonicalMappingFields,
  loadSourceNameToCanonicalIds,
  resolveArtifactsSourceNameToCanonicalIds,
  type SourceNameToCanonicalIds,
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

function preparedPersonnelSpec(
  personnel: ImportRows["officers"][number],
): Record<string, unknown> {
  const { id: _id, ...spec } = personnel;
  return Object.fromEntries(
    Object.entries(spec).filter(([, value]) => value !== undefined),
  );
}

function preparedAgencyPersonnelSpec(
  agencyPersonnel: ImportRows["agencyOfficers"][number],
): Record<string, unknown> {
  const { id: _id, ...spec } = agencyPersonnel;
  return Object.fromEntries(
    Object.entries(spec).filter(([, value]) => value !== undefined),
  );
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
  if (
    context.artifacts === undefined ||
    context.resolvedMappings === undefined
  ) {
    throw new Error(
      "Artifacts and source names must be loaded before hydrating resolved slugs.",
    );
  }

  const resolvedProperties: ResolvedProperties = {
    agencies: {},
    personnel: {},
  };
  for (const artifact of context.artifacts.spec.artifacts) {
    if (artifact.kind !== "Agencies" && artifact.kind !== "Personnel") {
      continue;
    }
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      const sourceName = sourceNameForImportRecord(recordName, record);
      if (artifact.kind === "Agencies") {
        const canonicalId =
          context.resolvedMappings.agencies[sourceName]?.canonicalId;
        if (canonicalId !== undefined) {
          await hydrateResolvedSlug(context, {
            resolvedProperties,
            collection: "agencies",
            kind: "Agency",
            sourceName,
            canonicalId,
            sourceInput: slugSourceInput("Agency", record),
          });
        }
        continue;
      }

      const canonicalId =
        context.resolvedMappings.personnel[sourceName]?.canonicalId;
      if (canonicalId !== undefined) {
        await hydrateResolvedSlug(context, {
          resolvedProperties,
          collection: "personnel",
          kind: "Personnel",
          sourceName,
          canonicalId,
          sourceInput: slugSourceInput("Personnel", record),
        });
      }
    }
  }

  return resolvedProperties;
}

async function persistResolvedSlugs(
  context: ImportArtifactsPipelineContext,
): Promise<void> {
  if (
    context.artifacts === undefined ||
    context.resolvedMappings === undefined ||
    context.rows === undefined
  ) {
    throw new Error(
      "Artifacts, source names, and rows must be available before persisting resolved slugs.",
    );
  }

  const agencyById = new Map(
    context.rows.agencies.map((agency) => [agency.id, agency]),
  );
  const personnelById = new Map(
    context.rows.officers.map((personnel) => [personnel.id, personnel]),
  );
  let cachedSlugs = 0;
  for (const artifact of context.artifacts.spec.artifacts) {
    if (artifact.kind !== "Agencies" && artifact.kind !== "Personnel") {
      continue;
    }
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      const sourceName = sourceNameForImportRecord(recordName, record);
      const kind = artifact.kind === "Agencies" ? "Agency" : "Personnel";
      const canonicalId =
        kind === "Agency"
          ? context.resolvedMappings.agencies[sourceName]?.canonicalId
          : context.resolvedMappings.personnel[sourceName]?.canonicalId;
      const slug =
        canonicalId === undefined
          ? undefined
          : kind === "Agency"
            ? agencyById.get(canonicalId)?.slug
            : personnelById.get(canonicalId)?.slug;
      if (
        canonicalId === undefined ||
        typeof slug !== "string" ||
        slug.trim().length === 0
      ) {
        continue;
      }

      await writeResolvedProperty({
        ...slugCacheInput({
          namespace: context.artifacts.metadata.namespace,
          kind,
          sourceName,
          canonicalId,
          sourceInput: slugSourceInput(kind, record),
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
  rows: ImportRows,
  sourceNameToCanonicalIds: SourceNameToCanonicalIds,
): void {
  const preparedPersonnelByCanonicalId = new Map(
    rows.officers.map((personnel) => [personnel.id, personnel]),
  );

  for (const artifact of artifacts.spec.artifacts.filter(
    (item) => item.kind === "Personnel",
  )) {
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      const sourceName = sourceNameForImportRecord(recordName, record);
      const canonicalId =
        sourceNameToCanonicalIds.personnel[sourceName]?.canonicalId;
      const personnel =
        canonicalId === undefined
          ? undefined
          : preparedPersonnelByCanonicalId.get(canonicalId);
      if (personnel === undefined) {
        throw new Error(
          `Prepared personnel row is missing for source personnel ${sourceName}.`,
        );
      }

      const source = valueAsRecord(record);
      const facade = dataContext.personnelFromSource({
        apiVersion: INTAKE_API_VERSION,
        namespace: artifacts.metadata.namespace,
        name: sourceName,
        spec: source,
      });
      facade.merge(preparedPersonnelSpec(personnel));
    }
  }
}

function addAgencyPersonnelSourceFacades(
  dataContext: DataContext,
  artifacts: ArtifactsEnvelope,
  rows: ImportRows,
  sourceNameToCanonicalIds: SourceNameToCanonicalIds,
): void {
  const preparedAgencyPersonnelByCanonicalId = new Map(
    rows.agencyOfficers.map((agencyPersonnel) => [
      agencyPersonnel.id,
      agencyPersonnel,
    ]),
  );

  for (const artifact of artifacts.spec.artifacts.filter(
    (item) => item.kind === "AgencyPersonnel",
  )) {
    for (const [recordName, record] of Object.entries(artifact.spec.records)) {
      const sourceName = sourceNameForImportRecord(recordName, record);
      const canonicalId =
        sourceNameToCanonicalIds.agencyPersonnel[sourceName]?.canonicalId;
      const agencyPersonnel =
        canonicalId === undefined
          ? undefined
          : preparedAgencyPersonnelByCanonicalId.get(canonicalId);
      if (agencyPersonnel === undefined) {
        throw new Error(
          `Prepared agency-personnel row is missing for source agency-personnel ${sourceName}.`,
        );
      }

      const source = valueAsRecord(record);
      const facade = dataContext.agencyPersonnelFromSource({
        apiVersion: INTAKE_API_VERSION,
        namespace: artifacts.metadata.namespace,
        name: sourceName,
        spec: source,
      });
      facade.merge(preparedAgencyPersonnelSpec(agencyPersonnel));
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
  resolvedMappings?: SourceNameToCanonicalIds;
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
  if (
    context.artifacts === undefined ||
    context.resolvedMappings === undefined
  ) {
    throw new Error(
      "Artifacts and source names must be available before caching agency coordinates.",
    );
  }

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
      const canonicalId =
        context.resolvedMappings.agencies[sourceName]?.canonicalId;
      if (
        canonicalId === undefined ||
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

async function resolveSourceNamesStage(
  context: ImportArtifactsPipelineContext,
): Promise<ImportArtifactsPipelineContext> {
  if (context.artifacts === undefined) {
    throw new Error("Artifacts must be read before resolving source names.");
  }

  context.commandInput.logger?.info("Reading SourceNameToCanonicalId records.");
  const mappings = await loadSourceNameToCanonicalIds(
    context.artifacts.metadata.namespace,
    { rootDir: context.workspaceRoot },
  );
  context.commandInput.logger?.info(
    "Validating SourceNameToCanonicalId file shape.",
  );
  context.commandInput.logger?.debug(
    {
      locationPathMappings: Object.keys(mappings.locationPaths).length,
      agencyMappings: Object.keys(mappings.agencies).length,
      personnelMappings: Object.keys(mappings.personnel).length,
      agencyPersonnelMappings: Object.keys(mappings.agencyPersonnel).length,
    },
    "SourceNameToCanonicalId records loaded.",
  );

  context.commandInput.logger?.info(
    "Resolving canonical SourceNameToCanonicalId records.",
  );
  const resolvedMappings = await resolveArtifactsSourceNameToCanonicalIds(
    context.artifacts,
    mappings,
    { rootDir: context.workspaceRoot },
  );
  context.commandInput.logger?.debug(
    {
      locationPathMappings: Object.keys(resolvedMappings.locationPaths).length,
      agencyMappings: Object.keys(resolvedMappings.agencies).length,
      personnelMappings: Object.keys(resolvedMappings.personnel).length,
      agencyPersonnelMappings: Object.keys(resolvedMappings.agencyPersonnel)
        .length,
    },
    "SourceNameToCanonicalId records resolved.",
  );

  context.commandInput.logger?.info(
    "Validating canonical SourceNameToCanonicalId records.",
  );
  assertCanonicalMappingFields(context.artifacts, resolvedMappings);
  return { ...context, resolvedMappings };
}

async function transformArtifactsStage(
  context: ImportArtifactsPipelineContext,
): Promise<ImportArtifactsPipelineContext> {
  if (
    context.artifacts === undefined ||
    context.resolvedMappings === undefined
  ) {
    throw new Error(
      "Artifacts and source names must be loaded before transforming artifacts.",
    );
  }

  context.commandInput.logger?.info("Transforming artifact records.");
  const resolvedProperties = await hydrateResolvedSlugs(context);
  const rows = transformArtifacts(
    context.artifacts,
    context.resolvedMappings,
    resolvedProperties,
  );
  context.commandInput.logger?.debug(
    {
      agencies: rows.agencies.length,
      officers: rows.officers.length,
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
      sourceNameToCanonicalIds: context.resolvedMappings,
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
    },
    sourceNameToCanonicalIds: context.resolvedMappings,
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
        personnel: error.rows.officers.length,
        agencyPersonnel: error.rows.agencyOfficers.length,
      },
      errors: [...error.errors],
      preparationMutations: [...error.rows.preparationMutations],
    },
    spec: { mutations: dataContext.toDatabaseMutationItems() },
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

function canonicalLocationPathIdForGeometry(
  recordKey: string,
  spec: Record<string, unknown>,
  mappings: SourceNameToCanonicalIds,
): { canonicalId: string; sourceLocationPathKey: string } {
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
  for (const candidate of [
    sourceLocationPathKey,
    sourceLocationPathId,
    recordKey,
  ]) {
    if (candidate === undefined) {
      continue;
    }
    const canonicalId = mappings.locationPaths[candidate]?.canonicalId;
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
    context.resolvedMappings === undefined ||
    context.artifacts === undefined ||
    context.commandInput.commandDirectory === undefined
  ) {
    throw new Error(
      "Artifacts, source mappings, and command directory are required to write LocationPathGeometry mutations.",
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
      canonicalLocationPathIdForGeometry(
        recordKey,
        spec,
        context.resolvedMappings,
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
    context.resolvedMappings === undefined ||
    context.databaseResult === undefined
  ) {
    throw new Error("DatabaseMutations must be prepared before writing.");
  }

  context.commandInput.logger?.info("Writing DatabaseMutations envelope.");
  if (context.commandInput.commandDirectory === undefined) {
    throw new Error(
      "Command directory is required to write DatabaseMutations.",
    );
  }
  const dataContext = new DataContext({
    rows: context.rows,
    operations: context.databaseResult.operations,
    sourceNameToCanonicalIds: context.resolvedMappings,
    commandName: context.commandName,
  });
  dataContext.mergeAgencyArtifacts(context.artifacts);
  addPersonnelSourceFacades(
    dataContext,
    context.artifacts,
    context.rows,
    context.resolvedMappings,
  );
  addAgencyPersonnelSourceFacades(
    dataContext,
    context.artifacts,
    context.rows,
    context.resolvedMappings,
  );
  const databaseMutations = dataContext.toDatabaseMutations({
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
  resolveSourceNamesStage,
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

    let context: ImportArtifactsPipelineContext = {
      commandInput,
      artifactsPath: commandInput.artifactsPath,
      commandName: commandInput.commandName,
      workspaceRoot: workspaceRootFromEnv(commandInput.env),
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
