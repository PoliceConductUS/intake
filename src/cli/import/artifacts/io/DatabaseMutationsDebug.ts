import { z } from "zod";
import { databaseMutationReferenceSchema } from "./DatabaseMutations.js";
import {
  IMPORT_MUTATION_KINDS,
  INTAKE_API_VERSION,
} from "../../../../shared/io/import-types.js";
import {
  firstIssuePath,
  yamlDigest,
  yamlResourcePath,
} from "../../../../shared/io/resource.js";
import {
  readYamlDocumentFile,
  writeYamlDocumentFile,
} from "../../../../shared/io/internal/yaml-document.js";
import {
  type EnvelopeReadOptions,
  type EnvelopeReadRef,
  resolveReadPath,
} from "./envelope-ref.js";

const metadataSchema = z
  .object({
    name: z.string().trim().min(1),
    namespace: z.string().trim().min(1),
    labels: z.record(z.string(), z.string()).optional(),
    annotations: z.record(z.string(), z.string()).optional(),
    sourceArtifactsName: z.string().trim().min(1).optional(),
    status: z.literal("failed").optional(),
    createdAt: z.string().trim().min(1).optional(),
    sourceArtifactsPath: z.string().trim().min(1).optional(),
    sourceArtifactsDigest: z.string().trim().min(1).optional(),
    artifactMutation: z
      .object({
        path: z.string().trim().min(1),
        digest: z.string().trim().min(1),
      })
      .strict()
      .optional(),
    databaseSchema: z.record(z.string(), z.unknown()).optional(),
    counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
    ownedColumns: z
      .object({
        agency: z.array(z.string()).optional(),
        personnel: z.array(z.string()).optional(),
        agencyPersonnel: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    errors: z.array(z.string()).optional(),
    preparationMutations: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .strict();

const debugDatabaseMutationInlineSchema = z
  .object({
    kind: z.enum(IMPORT_MUTATION_KINDS),
    name: z.string().trim().min(1),
    spec: z.record(z.string(), z.unknown()),
    ownedColumns: z.array(z.string()).optional(),
  })
  .strict();

const debugDatabaseMutationItemSchema = z.union([
  databaseMutationReferenceSchema,
  debugDatabaseMutationInlineSchema,
]);

export { debugDatabaseMutationInlineSchema, debugDatabaseMutationItemSchema };

export const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("DatabaseMutationsDebug"),
    metadata: metadataSchema,
    spec: z
      .object({
        mutations: z.array(debugDatabaseMutationItemSchema),
      })
      .strict(),
  })
  .strict();

export type DatabaseMutationsDebugEnvelope = z.infer<typeof schema>;
export type DatabaseMutationsDebugInput = Omit<
  DatabaseMutationsDebugEnvelope,
  "apiVersion" | "kind"
>;

function parseDatabaseMutationsDebug(
  value: unknown,
): DatabaseMutationsDebugEnvelope {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `DatabaseMutationsDebug is malformed at ${firstIssuePath(result.error)}.`,
    );
  }
  return result.data;
}

function newDatabaseMutationsDebug(
  input: DatabaseMutationsDebugInput,
): DatabaseMutationsDebugEnvelope {
  return parseDatabaseMutationsDebug({
    apiVersion: INTAKE_API_VERSION,
    kind: "DatabaseMutationsDebug",
    ...input,
  });
}

async function readDatabaseMutationsDebug(
  pathOrRef: string | EnvelopeReadRef,
  options: EnvelopeReadOptions = {},
): Promise<DatabaseMutationsDebugEnvelope> {
  const ref = resolveReadPath(pathOrRef, options, "DatabaseMutationsDebug");
  if (ref.kind !== undefined && ref.kind !== "DatabaseMutationsDebug") {
    throw new Error(
      `DatabaseMutationsDebug ref.kind ${ref.kind} does not match expected kind DatabaseMutationsDebug: ${ref.filePath}`,
    );
  }
  const { contents, document } = await readYamlDocumentFile(
    ref.filePath,
    "DatabaseMutationsDebug",
  );
  if (ref.sha256 !== undefined && yamlDigest(contents) !== ref.sha256) {
    throw new Error(`DatabaseMutationsDebug sha256 mismatch: ${ref.filePath}`);
  }
  const envelope = parseDatabaseMutationsDebug(document);
  if (
    options.expectedNamespace !== undefined &&
    envelope.metadata.namespace !== options.expectedNamespace
  ) {
    throw new Error(
      `DatabaseMutationsDebug namespace ${envelope.metadata.namespace} does not match expected namespace ${options.expectedNamespace}: ${ref.filePath}`,
    );
  }
  return envelope;
}

async function writeDatabaseMutationsDebug(
  directory: string,
  envelope: DatabaseMutationsDebugEnvelope,
): Promise<{ path: string }> {
  const parsed = parseDatabaseMutationsDebug(envelope);
  const filePath = yamlResourcePath(directory, parsed);
  await writeYamlDocumentFile(filePath, parsed);
  return { path: filePath };
}

export const DatabaseMutationsDebug = {
  kind: "DatabaseMutationsDebug",
  schema,
  new: newDatabaseMutationsDebug,
  read: readDatabaseMutationsDebug,
  write: writeDatabaseMutationsDebug,
};
