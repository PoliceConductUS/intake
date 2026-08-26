import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createCensusAgencyCoordinateResolver } from "./agency-coordinate-resolver.js";
import { resolveImportAddress } from "./agency-address-resolution.js";
import type {
  AgencyCoordinateRequest,
  AgencyCoordinateResolution,
} from "./agency-coordinate-types.js";
import { assertGeneratedSchemaCurrent } from "./assert-schema-current.js";
import { validateArtifactRecords } from "./validate-artifact-records.js";
import { loadDatabaseSchemaMetadata } from "../../database/schema.js";
import {
  defaultDatabaseClientFactory,
  type DatabaseClient,
  type DatabaseClientFactory,
} from "../../database/index.js";
import { readDatabaseRecordByColumn } from "../../database/entities.js";
import { DataContext } from "./data-context.js";
import { isRegistryKind } from "./facades/resolver-registry.js";
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
  createSourceNameToCanonicalIdLedger,
  type SourceNameToCanonicalIdLedger,
} from "../../state/source-name-to-canonical-id/index.js";
import {
  readResolvedProperty,
  type ResolvedPropertyCacheInput,
  writeResolvedProperty,
} from "../../state/resolved-property/index.js";
import { replayDatabaseMutations } from "../../replay/database-mutations/config.js";
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

function addSourceFacades(
  dataContext: DataContext,
  artifacts: ArtifactsEnvelope,
): void {
  const namespace = artifacts.metadata.namespace;
  for (const artifactKind of IMPORT_ARTIFACT_KINDS) {
    const recordKind = importTypeMetadata[artifactKind].recordKind;
    // LocationPathGeometry (streamed separately) is the only artifact kind with
    // no facade; every other kind resolves through the registry.
    if (!isRegistryKind(recordKind)) {
      continue;
    }
    for (const artifact of artifacts.spec.artifacts.filter(
      (item) => item.kind === artifactKind,
    )) {
      for (const [recordName, record] of Object.entries(
        artifact.spec.records,
      )) {
        dataContext.facadeFromSource(recordKind, {
          apiVersion: INTAKE_API_VERSION,
          namespace,
          name: sourceNameForImportRecord(recordName, record),
          spec: valueAsRecord(record),
          sourceFile: artifact.recordSources?.[recordName],
        });
      }
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

async function validateArtifactRecordsStage(
  context: ImportArtifactsPipelineContext,
): Promise<ImportArtifactsPipelineContext> {
  if (context.artifacts === undefined) {
    throw new Error("Artifacts must be loaded before validating records.");
  }
  validateArtifactRecords(context.artifacts);
  return context;
}

/**
 * The agency-resolution dependencies both the planning and the envelope-writing
 * passes share: the coordinate geocoder (census, or an injected mock in tests),
 * the administrative-area resolver, and the `ResolvedProperty` cache read/write
 * rooted at the workspace. One source of truth so the write pass resolves an
 * agency identically to the planning pass (and, once the planning pass is gone,
 * so it resolves at all).
 */
function agencyResolutionDeps(context: ImportArtifactsPipelineContext) {
  const logger = context.commandInput.logger;
  return {
    sourceNamespace: context.artifacts?.metadata.namespace ?? "",
    resolveAgencyCoordinates:
      context.commandInput.resolveAgencyCoordinates ??
      createCensusAgencyCoordinateResolver(undefined, {
        onProgress: (event) => {
          if (event.stage === "batch") {
            logger?.info(
              { entityType: "agency", total: event.total },
              `Resolving agency address coordinates for ${event.total} ${event.total === 1 ? "agency" : "agencies"}.`,
            );
            return;
          }
          logger?.info(
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
    resolvedPropertyCache: {
      read: (input: ResolvedPropertyCacheInput) =>
        readResolvedProperty({ ...input, rootDir: context.workspaceRoot }),
      write: (input: ResolvedPropertyCacheInput & { value: unknown }) =>
        writeResolvedProperty({ ...input, rootDir: context.workspaceRoot }),
    },
  };
}

async function closeClient(client: DatabaseClient): Promise<void> {
  try {
    await client.end();
  } catch {
    // The original connection or write error is the actionable failure.
  }
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
    context.artifactMutation === undefined
  ) {
    throw new Error("Artifacts must be validated before writing.");
  }
  const artifacts = context.artifacts;
  const ledger = context.ledger;
  const logger = context.commandInput.logger;

  logger?.info("Writing DatabaseMutations envelope.");
  if (context.commandInput.commandDirectory === undefined) {
    throw new Error(
      "Command directory is required to write DatabaseMutations.",
    );
  }
  const databaseUrl = (context.commandInput.env ?? process.env).DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error("DATABASE_URL is required to write database mutations.");
  }
  // Read-only connection (ADR 0019): validation and every facade's lazy
  // current-row read share it; the envelope is applied by the replay client.
  const deps = agencyResolutionDeps(context);
  const client = (
    context.commandInput.clientFactory ?? defaultDatabaseClientFactory
  )(databaseUrl);
  try {
    await client.connect();
    await client.query("select 1");
  } catch (error) {
    await closeClient(client);
    throw new Error(`Database connection failed: ${errorMessage(error)}`);
  }

  let databaseMutations;
  try {
    const { importSchema } = await loadDatabaseSchemaMetadata(client);
    assertGeneratedSchemaCurrent(importSchema.appliedMigrations);
    const dataContext = new DataContext({
      client,
      logger,
      ledger,
      commandName: context.commandName,
      resolvedPropertyStore: deps.resolvedPropertyCache,
      resolveAddress: (input) => resolveImportAddress(input, deps),
    });

    addSourceFacades(dataContext, artifacts);
    databaseMutations = await dataContext.toDatabaseMutations({
      namespace: artifacts.metadata.namespace,
      name: context.commandName,
      sourceArtifactsName: artifacts.metadata.name,
      sourceArtifactsPath: context.artifactsPath,
      sourceArtifactsDigest: await Artifacts.digest(context.artifactsPath),
      databaseSchema: importSchema,
      ...(context.artifactMutation.applied
        ? { artifactMutation: context.artifactMutation.reference }
        : {}),
    });
  } finally {
    await closeClient(client);
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
  validateArtifactRecordsStage,
  // Prepares, validates, emits, and applies in one pass over a single DataContext.
  writeDatabaseMutationsStage,
];

export async function importArtifacts(
  commandInput: ImportArtifactsCommandInput,
): Promise<ImportArtifactsResult> {
  if (
    commandInput.commandName === undefined ||
    commandInput.commandName.trim().length === 0
  ) {
    return {
      ok: false,
      error: "Command name is required to import artifacts.",
    };
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
  try {
    for (const stage of importArtifactsPipelineStages) {
      context = await stage(context);
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
  if (context.databaseMutationCounts === undefined) {
    return {
      ok: false,
      error: "DatabaseMutations pipeline finished without mutation counts.",
    };
  }
  return { ok: true, counts: context.databaseMutationCounts };
}
