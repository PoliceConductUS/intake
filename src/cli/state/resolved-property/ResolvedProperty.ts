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
      `Relative ${ref.kind ?? "ResolvedProperty"} ref requires relativeTo.`,
    );
  }

  const baseDirectory = path.dirname(options.relativeTo);
  const resolvedPath = path.resolve(baseDirectory, ref.path);
  const relativePath = path.relative(baseDirectory, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `${ref.kind ?? "ResolvedProperty"} ref.path escapes its directory: ${ref.path}`,
    );
  }
  return { ...ref, filePath: resolvedPath };
}

export const specSchema = z
  .object({
    subject: z
      .object({
        apiVersion: z.literal(INTAKE_API_VERSION),
        kind: z.string().trim().min(1),
        name: z.string().trim().min(1),
      })
      .strict(),
    targetProperty: z.string().trim().min(1),
    sources: z
      .record(
        z.string().trim().min(1),
        z
          .object({
            kind: z.string().trim().min(1),
            name: z.string().trim().min(1),
            inputFingerprint: z.string().trim().min(1),
          })
          .strict(),
      )
      .optional(),
    value: z.unknown(),
  })
  .strict();

export const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("ResolvedProperty"),
    metadata: z
      .object({
        name: z.string().trim().min(1),
        namespace: z.literal("intake"),
        labels: z.record(z.string(), z.string()).optional(),
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
    spec: specSchema,
  })
  .strict();

export type ResolvedPropertyEnvelope = z.infer<typeof schema>;
export type ResolvedPropertyInput = Omit<
  ResolvedPropertyEnvelope,
  "apiVersion" | "kind"
>;

function parseResolvedProperty(value: unknown): ResolvedPropertyEnvelope {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `ResolvedProperty is malformed at ${firstIssuePath(result.error)}.`,
    );
  }
  return result.data;
}

function newResolvedProperty(
  input: ResolvedPropertyInput,
): ResolvedPropertyEnvelope {
  return parseResolvedProperty({
    apiVersion: INTAKE_API_VERSION,
    kind: "ResolvedProperty",
    ...input,
  });
}

async function readResolvedPropertyEnvelope(
  pathOrRef: string | EnvelopeReadRef,
  options: EnvelopeReadOptions = {},
): Promise<ResolvedPropertyEnvelope> {
  const ref = resolveReadPath(pathOrRef, options);
  if (ref.kind !== undefined && ref.kind !== "ResolvedProperty") {
    throw new Error(
      `ResolvedProperty ref.kind ${ref.kind} does not match expected kind ResolvedProperty: ${ref.filePath}`,
    );
  }
  const { contents, document } = await readYamlDocumentFile(
    ref.filePath,
    "ResolvedProperty",
  );
  if (ref.sha256 !== undefined && yamlDigest(contents) !== ref.sha256) {
    throw new Error(`ResolvedProperty sha256 mismatch: ${ref.filePath}`);
  }
  const envelope = parseResolvedProperty(document);
  if (
    options.expectedNamespace !== undefined &&
    envelope.metadata.namespace !== options.expectedNamespace
  ) {
    throw new Error(
      `ResolvedProperty namespace ${envelope.metadata.namespace} does not match expected namespace ${options.expectedNamespace}: ${ref.filePath}`,
    );
  }
  return envelope;
}

async function writeResolvedPropertyEnvelope(
  directory: string,
  envelope: ResolvedPropertyEnvelope,
): Promise<{ path: string }> {
  const parsed = parseResolvedProperty(envelope);
  const filePath = yamlResourcePath(directory, parsed);
  await writeYamlDocumentFile(filePath, parsed);
  return { path: filePath };
}

export const ResolvedProperty = {
  kind: "ResolvedProperty",
  schema,
  new: newResolvedProperty,
  read: readResolvedPropertyEnvelope,
  write: writeResolvedPropertyEnvelope,
};
