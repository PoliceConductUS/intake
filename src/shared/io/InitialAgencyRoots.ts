import { z } from "zod";
import { INTAKE_API_VERSION } from "./import-types.js";
import { firstIssuePath, yamlDigest, yamlResourcePath } from "./resource.js";
import {
  readYamlDocumentFile,
  writeYamlDocumentFile,
} from "./internal/yaml-document.js";

const nonEmptyString = z.string().trim().min(1);

export const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("InitialAgencyRoots"),
    metadata: z
      .object({
        name: z.literal("initial"),
        namespace: nonEmptyString,
        labels: z.record(z.string(), z.string()).optional(),
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
    spec: z
      .object({
        agencySourceNames: z
          .array(nonEmptyString)
          .min(1)
          .refine(
            (names) => new Set(names).size === names.length,
            "Agency source names must be unique.",
          ),
      })
      .strict(),
  })
  .strict();

export type InitialAgencyRootsEnvelope = z.infer<typeof schema>;
export type InitialAgencyRootsInput = Omit<
  InitialAgencyRootsEnvelope,
  "apiVersion" | "kind"
>;

type EnvelopeReadOptions = {
  expectedNamespace?: string;
  expectedSha256?: string;
};

function parseInitialAgencyRoots(value: unknown): InitialAgencyRootsEnvelope {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `InitialAgencyRoots is malformed at ${firstIssuePath(result.error)}.`,
    );
  }
  return result.data;
}

function newInitialAgencyRoots(
  input: InitialAgencyRootsInput,
): InitialAgencyRootsEnvelope {
  return parseInitialAgencyRoots({
    apiVersion: INTAKE_API_VERSION,
    kind: "InitialAgencyRoots",
    ...input,
  });
}

async function readInitialAgencyRoots(
  filePath: string,
  options: EnvelopeReadOptions = {},
): Promise<InitialAgencyRootsEnvelope> {
  const { contents, document } = await readYamlDocumentFile(
    filePath,
    "InitialAgencyRoots",
  );
  if (
    options.expectedSha256 !== undefined &&
    yamlDigest(contents) !== options.expectedSha256
  ) {
    throw new Error(`InitialAgencyRoots sha256 mismatch: ${filePath}`);
  }
  const envelope = parseInitialAgencyRoots(document);
  if (
    options.expectedNamespace !== undefined &&
    envelope.metadata.namespace !== options.expectedNamespace
  ) {
    throw new Error(
      `InitialAgencyRoots namespace ${envelope.metadata.namespace} does not match expected namespace ${options.expectedNamespace}: ${filePath}`,
    );
  }
  return envelope;
}

async function writeInitialAgencyRoots(
  directory: string,
  envelope: InitialAgencyRootsEnvelope,
): Promise<{ path: string; sha256: string }> {
  const parsed = parseInitialAgencyRoots(envelope);
  const filePath = yamlResourcePath(directory, parsed);
  const contents = await writeYamlDocumentFile(filePath, parsed);
  return { path: filePath, sha256: yamlDigest(contents) };
}

export const InitialAgencyRoots = {
  kind: "InitialAgencyRoots",
  schema,
  new: newInitialAgencyRoots,
  read: readInitialAgencyRoots,
  write: writeInitialAgencyRoots,
};

export const read = readInitialAgencyRoots;
export const write = writeInitialAgencyRoots;
