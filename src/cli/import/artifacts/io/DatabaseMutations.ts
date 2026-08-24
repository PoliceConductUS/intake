import path from "node:path";
import { z } from "zod";
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
    // Records this import declined to update because a subject is under an
    // active suppression. Carried on the envelope, not only in the run log,
    // because the envelope is the artifact that outlives the run and gets
    // diffed against the next one. Optional so envelopes written before this
    // field existed still parse; absent and empty both mean "nothing skipped".
    suppressedSkips: z
      .array(
        z
          .object({
            entity: z.enum(["agency", "personnel", "agencyPersonnel"]),
            recordId: z.string().trim().min(1),
            suppressedSubjectIds: z
              .array(z.string().trim().min(1))
              .min(1)
              .readonly(),
            withheldColumns: z
              .array(z.string().trim().min(1))
              .min(1)
              .readonly(),
          })
          .strict(),
      )
      .readonly()
      .optional(),
  })
  .strict();

export const databaseMutationReferenceSchema = z
  .object({
    ref: z
      .object({
        path: z.string().trim().min(1),
        kind: z.enum(IMPORT_MUTATION_KINDS),
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

  return {
    ...databaseMutations,
    spec: {
      mutations: await Promise.all(
        databaseMutations.spec.mutations.map((mutationItem) =>
          "ref" in mutationItem
            ? databaseMutationFromRef(
                filePath,
                databaseMutations.metadata.namespace,
                mutationItem.ref,
              )
            : mutationItem,
        ),
      ),
    },
  };
}

async function writeDatabaseMutations(
  directory: string,
  envelope: DatabaseMutationsEnvelope,
): Promise<{ path: string }> {
  const parsed = parseDatabaseMutations(envelope);
  const filePath = yamlResourcePath(directory, parsed);
  await writeYamlDocumentFile(filePath, parsed);
  return { path: filePath };
}

export const DatabaseMutations = {
  kind: "DatabaseMutations",
  schema,
  new: newDatabaseMutations,
  read: readDatabaseMutations,
  write: writeDatabaseMutations,
};
