import path from "node:path";
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

type EnvelopeReadRef =
  | { path: string; kind?: string; sha256?: string }
  | { ref: { path: string; kind?: string; sha256?: string } };

type EnvelopeReadOptions = {
  expectedNamespace?: string;
  relativeTo?: string;
};

function refValue(pathOrRef: string | EnvelopeReadRef): {
  path: string;
  kind?: string;
  sha256?: string;
} {
  if (typeof pathOrRef === "string") {
    return { path: pathOrRef };
  }
  if ("ref" in pathOrRef) {
    return pathOrRef.ref;
  }
  return pathOrRef;
}

function resolveReadPath(
  pathOrRef: string | EnvelopeReadRef,
  options: EnvelopeReadOptions,
): { filePath: string; kind?: string; sha256?: string } {
  const ref = refValue(pathOrRef);
  if (typeof pathOrRef === "string" || path.isAbsolute(ref.path)) {
    return { ...ref, filePath: ref.path };
  }
  if (
    options.relativeTo === undefined ||
    options.relativeTo.trim().length === 0
  ) {
    throw new Error(
      `Relative ${ref.kind ?? "DatabaseMutationsDebug"} ref requires relativeTo.`,
    );
  }

  const baseDirectory = path.dirname(options.relativeTo);
  const resolvedPath = path.resolve(baseDirectory, ref.path);
  const relativePath = path.relative(baseDirectory, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `${ref.kind ?? "DatabaseMutationsDebug"} ref.path escapes its directory: ${ref.path}`,
    );
  }
  return { ...ref, filePath: resolvedPath };
}

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
  const ref = resolveReadPath(pathOrRef, options);
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
