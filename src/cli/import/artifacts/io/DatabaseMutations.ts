import path from "node:path";
import { z } from "zod";
import {
  IMPORT_MUTATION_KINDS,
  INTAKE_API_VERSION,
} from "../../../../shared/io/import-types.js";
import {
  firstIssuePath,
  yamlDigest,
  yamlResourceFileName,
  yamlResourcePath,
} from "../../../../shared/io/resource.js";
import {
  readYamlDocumentFile,
  writeYamlDocumentFile,
} from "../../../../shared/io/internal/yaml-document.js";
import {
  type DatabaseMutationEnvelope,
  readDatabaseMutation,
} from "./DatabaseMutation.js";
import { importMutationEnvelopeTypes } from "./generated-mutations/index.js";

type EnvelopeReadRef =
  | { path: string; kind?: string; sha256?: string }
  | { ref: { path: string; kind?: string; sha256?: string } };

type EnvelopeReadOptions = {
  expectedNamespace?: string;
  relativeTo?: string;
};

type MutationEnvelopeType = {
  schema: z.ZodType<DatabaseMutationEnvelope>;
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
      `Relative ${ref.kind ?? "DatabaseMutations"} ref requires relativeTo.`,
    );
  }

  const baseDirectory = path.dirname(options.relativeTo);
  const resolvedPath = path.resolve(baseDirectory, ref.path);
  const relativePath = path.relative(baseDirectory, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `${ref.kind ?? "DatabaseMutations"} ref.path escapes its directory: ${ref.path}`,
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
  })
  .strict();

export const databaseMutationReferenceSchema = z
  .object({
    ref: z
      .object({
        path: z.string().trim().min(1),
        // A single-mutation kind, or "DatabaseMutations" for a CHUNK file — a
        // nested DatabaseMutations envelope holding many mutations, so the
        // top-level never serializes every mutation as one string.
        kind: z.enum(IMPORT_MUTATION_KINDS).or(z.literal("DatabaseMutations")),
        sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
  })
  .strict();

export const databaseMutationInlineSchema = z
  .object({
    kind: z.enum(IMPORT_MUTATION_KINDS),
    name: z.string().trim().min(1),
    spec: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((mutation, context) => {
    const envelopeType = (
      importMutationEnvelopeTypes as Record<
        string,
        MutationEnvelopeType | undefined
      >
    )[mutation.kind];
    const result = envelopeType?.schema.safeParse({
      apiVersion: INTAKE_API_VERSION,
      kind: mutation.kind,
      metadata: { name: mutation.name, namespace: "validation" },
      spec: mutation.spec,
    });
    if (result?.success === false) {
      for (const issue of result.error.issues) {
        context.addIssue({ ...issue, path: ["spec", ...issue.path.slice(3)] });
      }
    }
  });

export const databaseMutationItemSchema = z.union([
  databaseMutationReferenceSchema,
  databaseMutationInlineSchema,
]);

export const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("DatabaseMutations"),
    metadata: metadataSchema,
    spec: z
      .object({
        mutations: z.array(databaseMutationItemSchema),
      })
      .strict(),
  })
  .strict();

export type DatabaseMutationsEnvelope = z.infer<typeof schema>;
export type DatabaseMutationsInput = Omit<
  DatabaseMutationsEnvelope,
  "apiVersion" | "kind"
>;
export type DatabaseMutationItem = z.infer<typeof databaseMutationItemSchema>;
export type DatabaseMutationInline = z.infer<
  typeof databaseMutationInlineSchema
>;

function parseDatabaseMutations(value: unknown): DatabaseMutationsEnvelope {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `DatabaseMutations is malformed at ${firstIssuePath(result.error)}.`,
    );
  }
  return result.data;
}

function newDatabaseMutations(
  input: DatabaseMutationsInput,
): DatabaseMutationsEnvelope {
  return parseDatabaseMutations({
    apiVersion: INTAKE_API_VERSION,
    kind: "DatabaseMutations",
    ...input,
  });
}

async function databaseMutationFromRef(
  databaseMutationsPath: string,
  namespace: string | undefined,
  ref: { path: string; kind: string; sha256?: string },
): Promise<DatabaseMutationInline> {
  const mutation = await readDatabaseMutation(ref, {
    relativeTo: databaseMutationsPath,
    expectedNamespace: namespace,
  });
  return {
    kind: mutation.kind,
    name: mutation.metadata.name,
    spec: mutation.spec,
  };
}

async function readDatabaseMutations(
  filePath: string,
  options: EnvelopeReadOptions & { raw: true },
): Promise<DatabaseMutationsEnvelope>;
async function readDatabaseMutations(
  filePath: string,
  options?: EnvelopeReadOptions & { raw?: false },
): Promise<
  Omit<DatabaseMutationsEnvelope, "spec"> & {
    spec: { mutations: DatabaseMutationInline[] };
  }
>;
async function readDatabaseMutations(
  filePath: string,
  options: EnvelopeReadOptions & { raw?: boolean } = {},
): Promise<DatabaseMutationsEnvelope> {
  const ref = resolveReadPath(filePath, options);
  const { contents, document } = await readYamlDocumentFile(
    ref.filePath,
    "DatabaseMutations",
  );
  if (ref.sha256 !== undefined && yamlDigest(contents) !== ref.sha256) {
    throw new Error(`DatabaseMutations sha256 mismatch: ${ref.filePath}`);
  }
  const databaseMutations = parseDatabaseMutations(document);
  if (
    options.expectedNamespace !== undefined &&
    databaseMutations.metadata.namespace !== options.expectedNamespace
  ) {
    throw new Error(
      `DatabaseMutations namespace ${databaseMutations.metadata.namespace} does not match expected namespace ${options.expectedNamespace}: ${ref.filePath}`,
    );
  }
  if (options.raw === true) {
    return databaseMutations;
  }

  const namespace = databaseMutations.metadata.namespace;
  const expanded = await Promise.all(
    databaseMutations.spec.mutations.map(
      async (mutationItem): Promise<DatabaseMutationInline[]> => {
        if (!("ref" in mutationItem)) {
          return [mutationItem];
        }
        if (mutationItem.ref.kind === "DatabaseMutations") {
          // Chunk file: read it (recursively expanding its refs) and inline.
          const chunkPath = path.resolve(
            path.dirname(filePath),
            mutationItem.ref.path,
          );
          const chunk = await readDatabaseMutations(chunkPath, {
            expectedNamespace: namespace,
          });
          return chunk.spec.mutations;
        }
        return [
          await databaseMutationFromRef(filePath, namespace, mutationItem.ref),
        ];
      },
    ),
  );

  return {
    ...databaseMutations,
    spec: { mutations: expanded.flat() },
  };
}

// Maximum mutations serialized into one DatabaseMutations file. A larger set is
// split into chunk files referenced from the top-level, so no single file
// approaches V8's string-length limit.
const MUTATIONS_PER_FILE = 5000;

/** Rewrite a ref path (relative to `fromDir`) to be relative to `toDir`. */
function rebaseMutationItem(
  item: DatabaseMutationItem,
  fromDir: string,
  toDir: string,
): DatabaseMutationItem {
  if (!("ref" in item)) {
    return item;
  }
  return {
    ref: {
      ...item.ref,
      path: path.relative(toDir, path.resolve(fromDir, item.ref.path)),
    },
  };
}

async function writeDatabaseMutations(
  directory: string,
  envelope: DatabaseMutationsEnvelope,
): Promise<{ path: string }> {
  const parsed = parseDatabaseMutations(envelope);
  const filePath = yamlResourcePath(directory, parsed);
  const topDirectory = path.dirname(filePath);

  if (parsed.spec.mutations.length <= MUTATIONS_PER_FILE) {
    await writeYamlDocumentFile(filePath, parsed);
    return { path: filePath };
  }

  const recordsDirectory = `${path.basename(filePath, path.extname(filePath))}.records`;
  const chunkDirectory = path.join(topDirectory, recordsDirectory);
  const chunkCount = Math.ceil(
    parsed.spec.mutations.length / MUTATIONS_PER_FILE,
  );
  const chunkReferences: DatabaseMutationItem[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const chunkMutations = parsed.spec.mutations
      .slice(index * MUTATIONS_PER_FILE, (index + 1) * MUTATIONS_PER_FILE)
      // Existing refs (e.g. geometry) were relative to the top-level file; make
      // them relative to the chunk file that now holds them.
      .map((item) => rebaseMutationItem(item, topDirectory, chunkDirectory));
    const chunk = newDatabaseMutations({
      metadata: {
        name: `${parsed.metadata.name}-${index}`,
        namespace: parsed.metadata.namespace,
      },
      spec: { mutations: chunkMutations },
    });
    const chunkPath = path.join(
      chunkDirectory,
      yamlResourceFileName(chunk.metadata.name, "DatabaseMutations"),
    );
    const contents = await writeYamlDocumentFile(chunkPath, chunk);
    chunkReferences.push({
      ref: {
        path: path.relative(topDirectory, chunkPath),
        kind: "DatabaseMutations",
        sha256: yamlDigest(contents),
      },
    });
  }

  await writeYamlDocumentFile(
    filePath,
    newDatabaseMutations({
      metadata: parsed.metadata,
      spec: { mutations: chunkReferences },
    }),
  );
  return { path: filePath };
}

export const DatabaseMutations = {
  kind: "DatabaseMutations",
  schema,
  new: newDatabaseMutations,
  read: readDatabaseMutations,
  write: writeDatabaseMutations,
};
