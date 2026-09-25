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
    kind: z.literal("PropertyCorrection"),
    metadata: z
      .object({
        name: nonEmptyString,
        namespace: nonEmptyString,
        labels: z.record(z.string(), z.string()).optional(),
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .strict(),
    spec: z
      .object({
        subject: z
          .object({ kind: nonEmptyString, name: nonEmptyString })
          .strict(),
        targetProperty: nonEmptyString,
        entries: z
          .array(
            z
              .object({
                from: z.json(),
                value: z.json(),
                recordedAt: z.string().datetime(),
                commandId: nonEmptyString,
                inputFingerprint: nonEmptyString.optional(),
              })
              .strict(),
          )
          .refine(
            (entries) =>
              entries.filter((e) => e.inputFingerprint === undefined).length ===
              1,
            "Exactly one active correction is required.",
          ),
      })
      .strict(),
  })
  .strict();

export type PropertyCorrectionEnvelope = z.infer<typeof schema>;
export type PropertyCorrectionInput = Omit<
  PropertyCorrectionEnvelope,
  "apiVersion" | "kind"
>;

type EnvelopeReadOptions = {
  expectedNamespace?: string;
  expectedSha256?: string;
};

function parsePropertyCorrection(value: unknown): PropertyCorrectionEnvelope {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `PropertyCorrection is malformed at ${firstIssuePath(result.error)}.`,
    );
  }
  return result.data;
}

function newPropertyCorrection(
  input: PropertyCorrectionInput,
): PropertyCorrectionEnvelope {
  return parsePropertyCorrection({
    apiVersion: INTAKE_API_VERSION,
    kind: "PropertyCorrection",
    ...input,
  });
}

async function readPropertyCorrection(
  filePath: string,
  options: EnvelopeReadOptions = {},
): Promise<PropertyCorrectionEnvelope> {
  const { contents, document } = await readYamlDocumentFile(
    filePath,
    "PropertyCorrection",
  );
  if (
    options.expectedSha256 !== undefined &&
    yamlDigest(contents) !== options.expectedSha256
  ) {
    throw new Error(`PropertyCorrection sha256 mismatch: ${filePath}`);
  }
  const envelope = parsePropertyCorrection(document);
  if (
    options.expectedNamespace !== undefined &&
    envelope.metadata.namespace !== options.expectedNamespace
  ) {
    throw new Error(
      `PropertyCorrection namespace ${envelope.metadata.namespace} does not match expected namespace ${options.expectedNamespace}: ${filePath}`,
    );
  }
  return envelope;
}

async function writePropertyCorrection(
  directory: string,
  envelope: PropertyCorrectionEnvelope,
): Promise<{ path: string; sha256: string }> {
  const parsed = parsePropertyCorrection(envelope);
  const filePath = yamlResourcePath(directory, parsed);
  const contents = await writeYamlDocumentFile(filePath, parsed);
  return { path: filePath, sha256: yamlDigest(contents) };
}

export const PropertyCorrection = {
  kind: "PropertyCorrection",
  schema,
  new: newPropertyCorrection,
  read: readPropertyCorrection,
  write: writePropertyCorrection,
};

export const read = readPropertyCorrection;
export const write = writePropertyCorrection;
