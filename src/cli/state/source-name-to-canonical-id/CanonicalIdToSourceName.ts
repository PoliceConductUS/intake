import { z } from "zod";
import { INTAKE_API_VERSION } from "../../../shared/io/import-types.js";
import {
  firstIssuePath,
  yamlResourcePath,
} from "../../../shared/io/resource.js";
import {
  readYamlDocumentFile,
  writeYamlDocumentFile,
} from "../../../shared/io/internal/yaml-document.js";

// The reverse of SourceNameToCanonicalId (ADR 0023): keyed by a canonical id, it
// records the namespace-local source id that maps to it, so a context can hand a
// source back its own id for an entity without a directory scan. Lives beside the
// forward records in the same `<namespace>/<kind>/` folder — the distinct kind
// suffix keeps the two file sets from colliding.
export const specSchema = z
  .object({
    kind: z.string().trim().min(1),
    sourceName: z.string().trim().min(1),
  })
  .strict();

export const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("CanonicalIdToSourceName"),
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

export type CanonicalIdToSourceNameEnvelope = z.infer<typeof schema>;
export type CanonicalIdToSourceNameInput = Omit<
  CanonicalIdToSourceNameEnvelope,
  "apiVersion" | "kind"
>;

function parse(value: unknown): CanonicalIdToSourceNameEnvelope {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `CanonicalIdToSourceName is malformed at ${firstIssuePath(result.error)}.`,
    );
  }
  return result.data;
}

function newCanonicalIdToSourceName(
  input: CanonicalIdToSourceNameInput,
): CanonicalIdToSourceNameEnvelope {
  return parse({
    apiVersion: INTAKE_API_VERSION,
    kind: "CanonicalIdToSourceName",
    ...input,
  });
}

async function readCanonicalIdToSourceName(
  filePath: string,
  options: { expectedNamespace?: string } = {},
): Promise<CanonicalIdToSourceNameEnvelope> {
  const { document } = await readYamlDocumentFile(
    filePath,
    "CanonicalIdToSourceName",
  );
  const envelope = parse(document);
  if (
    options.expectedNamespace !== undefined &&
    envelope.metadata.namespace !== options.expectedNamespace
  ) {
    throw new Error(
      `CanonicalIdToSourceName namespace ${envelope.metadata.namespace} does not match expected namespace ${options.expectedNamespace}: ${filePath}`,
    );
  }
  return envelope;
}

async function writeCanonicalIdToSourceName(
  directory: string,
  envelope: CanonicalIdToSourceNameEnvelope,
): Promise<{ path: string }> {
  const parsed = parse(envelope);
  const filePath = yamlResourcePath(directory, parsed);
  await writeYamlDocumentFile(filePath, parsed);
  return { path: filePath };
}

export const CanonicalIdToSourceName = {
  kind: "CanonicalIdToSourceName",
  schema,
  new: newCanonicalIdToSourceName,
  read: readCanonicalIdToSourceName,
  write: writeCanonicalIdToSourceName,
};
