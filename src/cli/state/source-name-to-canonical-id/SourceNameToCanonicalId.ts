import path from "node:path";
import { z } from "zod";
import { INTAKE_API_VERSION } from "../../../shared/io/import-types.js";
import {
  firstIssuePath,
  yamlDigest,
  yamlResourcePath,
} from "../../../shared/io/resource.js";
import {
  readYamlDocumentFile,
  writeYamlDocumentFile,
} from "../../../shared/io/internal/yaml-document.js";

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
      `Relative ${ref.kind ?? "SourceNameToCanonicalId"} ref requires relativeTo.`,
    );
  }

  const baseDirectory = path.dirname(options.relativeTo);
  const resolvedPath = path.resolve(baseDirectory, ref.path);
  const relativePath = path.relative(baseDirectory, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `${ref.kind ?? "SourceNameToCanonicalId"} ref.path escapes its directory: ${ref.path}`,
    );
  }
  return { ...ref, filePath: resolvedPath };
}

export const specSchema = z
  .object({
    kind: z.string().trim().min(1),
    canonicalId: z.string().trim().min(1),
  })
  .strict();

export const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("SourceNameToCanonicalId"),
    metadata: z
      .object({
        name: z.string().trim().min(1),
        namespace: z.string().trim().min(1),
        labels: z.record(z.string(), z.string()).optional(),
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
    spec: specSchema,
  })
  .strict();

export type SourceNameToCanonicalIdEnvelope = z.infer<typeof schema>;
export type SourceNameToCanonicalIdInput = Omit<
  SourceNameToCanonicalIdEnvelope,
  "apiVersion" | "kind"
>;

function parseSourceNameToCanonicalId(
  value: unknown,
): SourceNameToCanonicalIdEnvelope {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `SourceNameToCanonicalId is malformed at ${firstIssuePath(result.error)}.`,
    );
  }
  return result.data;
}

function newSourceNameToCanonicalId(
  input: SourceNameToCanonicalIdInput,
): SourceNameToCanonicalIdEnvelope {
  return parseSourceNameToCanonicalId({
    apiVersion: INTAKE_API_VERSION,
    kind: "SourceNameToCanonicalId",
    ...input,
  });
}

async function readSourceNameToCanonicalId(
  pathOrRef: string | EnvelopeReadRef,
  options: EnvelopeReadOptions = {},
): Promise<SourceNameToCanonicalIdEnvelope> {
  const ref = resolveReadPath(pathOrRef, options);
  if (ref.kind !== undefined && ref.kind !== "SourceNameToCanonicalId") {
    throw new Error(
      `SourceNameToCanonicalId ref.kind ${ref.kind} does not match expected kind SourceNameToCanonicalId: ${ref.filePath}`,
    );
  }
  const { contents, document } = await readYamlDocumentFile(
    ref.filePath,
    "SourceNameToCanonicalId",
  );
  if (ref.sha256 !== undefined && yamlDigest(contents) !== ref.sha256) {
    throw new Error(`SourceNameToCanonicalId sha256 mismatch: ${ref.filePath}`);
  }
  const envelope = parseSourceNameToCanonicalId(document);
  if (
    options.expectedNamespace !== undefined &&
    envelope.metadata.namespace !== options.expectedNamespace
  ) {
    throw new Error(
      `SourceNameToCanonicalId namespace ${envelope.metadata.namespace} does not match expected namespace ${options.expectedNamespace}: ${ref.filePath}`,
    );
  }
  return envelope;
}

async function writeSourceNameToCanonicalId(
  directory: string,
  envelope: SourceNameToCanonicalIdEnvelope,
): Promise<{ path: string }> {
  const parsed = parseSourceNameToCanonicalId(envelope);
  const filePath = yamlResourcePath(directory, parsed);
  await writeYamlDocumentFile(filePath, parsed);
  return { path: filePath };
}

export const SourceNameToCanonicalId = {
  kind: "SourceNameToCanonicalId",
  schema,
  new: newSourceNameToCanonicalId,
  read: readSourceNameToCanonicalId,
  write: writeSourceNameToCanonicalId,
};
