import path from "node:path";
import { z } from "zod";
import {
  ArtifactMutation,
  type ArtifactMutationSpec,
  artifactMutationSpecSchema,
} from "./ArtifactMutation.js";
import { INTAKE_API_VERSION } from "../../../../shared/io/import-types.js";
import {
  firstIssuePath,
  yamlDigest,
  yamlResourcePath,
} from "../../../../shared/io/resource.js";
import {
  readYamlDocumentDigest,
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
      `Relative ${ref.kind ?? "ArtifactMutations"} ref requires relativeTo.`,
    );
  }

  const baseDirectory = path.dirname(options.relativeTo);
  const resolvedPath = path.resolve(baseDirectory, ref.path);
  const relativePath = path.relative(baseDirectory, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `${ref.kind ?? "ArtifactMutations"} ref.path escapes its directory: ${ref.path}`,
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
  })
  .strict();

export const artifactMutationReferenceSchema = z
  .object({
    ref: z
      .object({
        path: z.string().trim().min(1),
        kind: z.literal("ArtifactMutation"),
        sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
  })
  .strict();

export const artifactMutationItemSchema = z.union([
  artifactMutationSpecSchema,
  artifactMutationReferenceSchema,
]);

export const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("ArtifactMutations"),
    metadata: metadataSchema,
    spec: z
      .object({
        mutations: z.array(artifactMutationItemSchema).min(1),
      })
      .strict(),
  })
  .strict();

export type ArtifactMutationsEnvelope = z.infer<typeof schema>;
export type ArtifactMutationsInput = Omit<
  ArtifactMutationsEnvelope,
  "apiVersion" | "kind"
>;
export type ArtifactMutationsItem =
  | ArtifactMutationSpec
  | { ref: { path: string; kind: "ArtifactMutation"; sha256?: string } };

function parseArtifactMutations(value: unknown): ArtifactMutationsEnvelope {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `ArtifactMutations is malformed at ${firstIssuePath(result.error)}.`,
    );
  }
  return result.data;
}

function newArtifactMutations(
  input: ArtifactMutationsInput,
): ArtifactMutationsEnvelope {
  return parseArtifactMutations({
    apiVersion: INTAKE_API_VERSION,
    kind: "ArtifactMutations",
    ...input,
  });
}

type ArtifactMutationsReadOptions = EnvelopeReadOptions & { raw?: boolean };

async function artifactMutationSpecFromRef(
  mutationPath: string,
  ref: { path: string; kind: "ArtifactMutation"; sha256?: string },
): Promise<ArtifactMutationSpec> {
  const mutation = await ArtifactMutation.read(ref, {
    relativeTo: mutationPath,
    expectedNamespace: "manual",
  });
  return mutation.spec;
}

async function readArtifactMutations(
  filePath: string,
  options: ArtifactMutationsReadOptions & { raw: true },
): Promise<ArtifactMutationsEnvelope>;
async function readArtifactMutations(
  filePath: string,
  options?: ArtifactMutationsReadOptions & { raw?: false },
): Promise<
  Omit<ArtifactMutationsEnvelope, "spec"> & {
    spec: { mutations: ArtifactMutationSpec[] };
  }
>;
async function readArtifactMutations(
  filePath: string,
  options: ArtifactMutationsReadOptions = {},
): Promise<ArtifactMutationsEnvelope> {
  const ref = resolveReadPath(filePath, options);
  const { contents, document } = await readYamlDocumentFile(
    ref.filePath,
    "ArtifactMutations",
  );
  if (ref.sha256 !== undefined && yamlDigest(contents) !== ref.sha256) {
    throw new Error(`ArtifactMutations sha256 mismatch: ${ref.filePath}`);
  }
  const mutation = parseArtifactMutations(document);
  if (
    options.expectedNamespace !== undefined &&
    mutation.metadata.namespace !== options.expectedNamespace
  ) {
    throw new Error(
      `ArtifactMutations namespace ${mutation.metadata.namespace} does not match expected namespace ${options.expectedNamespace}: ${ref.filePath}`,
    );
  }
  if (options.raw === true) {
    return mutation;
  }

  return {
    ...mutation,
    spec: {
      mutations: await Promise.all(
        mutation.spec.mutations.map((mutationItem) =>
          "ref" in mutationItem
            ? artifactMutationSpecFromRef(filePath, mutationItem.ref)
            : mutationItem,
        ),
      ),
    },
  };
}

async function writeArtifactMutations(
  directory: string,
  envelope: ArtifactMutationsEnvelope,
): Promise<{ path: string }> {
  const parsed = parseArtifactMutations(envelope);
  const filePath = yamlResourcePath(directory, parsed);
  await writeYamlDocumentFile(filePath, parsed);
  return { path: filePath };
}

export const ArtifactMutations = {
  kind: "ArtifactMutations",
  schema,
  new: newArtifactMutations,
  read: readArtifactMutations,
  write: writeArtifactMutations,
  digest(filePath: string): Promise<string> {
    return readYamlDocumentDigest(filePath, "ArtifactMutations");
  },
};
