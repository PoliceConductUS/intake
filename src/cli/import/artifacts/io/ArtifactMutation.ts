import { z } from "zod";
import { INTAKE_API_VERSION } from "../../../../shared/io/import-types.js";
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
  })
  .strict();

const mutationEvidenceSchema = z.array(z.record(z.string(), z.unknown()));

export const artifactMutationOperationSourceSchema = z
  .object({
    namespace: z.string().trim().min(1),
    command: z
      .object({
        name: z.string().trim().min(1),
      })
      .strict(),
    kind: z.string().trim().min(1),
    name: z.string().trim().min(1),
  })
  .strict();

function requireValueForSet(
  operation: { action: "set"; value?: unknown },
  context: z.RefinementCtx,
): void {
  if (!Object.prototype.hasOwnProperty.call(operation, "value")) {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: "Required",
    });
  }
}

export const artifactMutationOperationBaseSchema = z
  .object({
    action: z.literal("set"),
    path: z
      .string()
      .trim()
      .min(1)
      .refine((value) => value.split(".").every((part) => part.length > 0), {
        message: "Path segments must not be empty",
      }),
    value: z.unknown(),
    reason: z.string().trim().min(1),
    source: artifactMutationOperationSourceSchema,
    evidence: mutationEvidenceSchema.optional(),
  })
  .strict();

export const artifactMutationOperationSchema =
  artifactMutationOperationBaseSchema.superRefine(requireValueForSet);

const agencySetMutationSchema =
  artifactMutationOperationBaseSchema.superRefine(requireValueForSet);

const personnelSetMutationSchema = artifactMutationOperationBaseSchema
  .extend({
    path: z.enum([
      "first_name",
      "last_name",
      "middle_name",
      "prefix",
      "suffix",
    ]),
  })
  .superRefine(requireValueForSet);

const agencyPersonnelSetMutationSchema = artifactMutationOperationBaseSchema
  .extend({
    path: z.enum([
      "agency_id",
      "personnel_id",
      "badge_number",
      "start_date",
      "end_date",
      "title",
      "license_id",
    ]),
  })
  .superRefine(requireValueForSet);

export const artifactMutationTargetSchema = z
  .object({
    namespace: z.string().trim().min(1),
    command: z
      .object({
        name: z.string().trim().min(1),
      })
      .strict(),
    kind: z.enum(["Agency", "Personnel", "AgencyPersonnel"]),
    name: z.string().trim().min(1),
  })
  .strict();

export const artifactMutationSpecSchema = z
  .object({
    target: artifactMutationTargetSchema,
    operations: z.array(artifactMutationOperationSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const schema =
      value.target.kind === "Agency"
        ? agencySetMutationSchema
        : value.target.kind === "Personnel"
          ? personnelSetMutationSchema
          : agencyPersonnelSetMutationSchema;
    const result = z.array(schema).safeParse(value.operations);
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({
          ...issue,
          path: ["operations", ...issue.path],
        });
      }
    }
  });

export const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("ArtifactMutation"),
    metadata: metadataSchema,
    spec: artifactMutationSpecSchema,
  })
  .strict();

export type ArtifactMutationEnvelope = z.infer<typeof schema>;
export type ArtifactMutationInput = Omit<
  ArtifactMutationEnvelope,
  "apiVersion" | "kind"
>;
export type ArtifactMutationSpec = z.infer<typeof artifactMutationSpecSchema>;
export type ArtifactMutationOperation = z.infer<
  typeof artifactMutationOperationSchema
>;

function parseArtifactMutation(value: unknown): ArtifactMutationEnvelope {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `ArtifactMutation is malformed at ${firstIssuePath(result.error)}.`,
    );
  }
  return result.data;
}

function newArtifactMutation(
  input: ArtifactMutationInput,
): ArtifactMutationEnvelope {
  return parseArtifactMutation({
    apiVersion: INTAKE_API_VERSION,
    kind: "ArtifactMutation",
    ...input,
  });
}

async function readArtifactMutation(
  pathOrRef: string | EnvelopeReadRef,
  options: EnvelopeReadOptions = {},
): Promise<ArtifactMutationEnvelope> {
  const ref = resolveReadPath(pathOrRef, options, "ArtifactMutation");
  if (ref.kind !== undefined && ref.kind !== "ArtifactMutation") {
    throw new Error(
      `ArtifactMutation ref.kind ${ref.kind} does not match expected kind ArtifactMutation: ${ref.filePath}`,
    );
  }
  const { contents, document } = await readYamlDocumentFile(
    ref.filePath,
    "ArtifactMutation",
  );
  if (ref.sha256 !== undefined && yamlDigest(contents) !== ref.sha256) {
    throw new Error(`ArtifactMutation sha256 mismatch: ${ref.filePath}`);
  }
  const envelope = parseArtifactMutation(document);
  if (
    options.expectedNamespace !== undefined &&
    envelope.metadata.namespace !== options.expectedNamespace
  ) {
    throw new Error(
      `ArtifactMutation namespace ${envelope.metadata.namespace} does not match expected namespace ${options.expectedNamespace}: ${ref.filePath}`,
    );
  }
  return envelope;
}

async function writeArtifactMutation(
  directory: string,
  envelope: ArtifactMutationEnvelope,
): Promise<{ path: string }> {
  const parsed = parseArtifactMutation(envelope);
  const filePath = yamlResourcePath(directory, parsed);
  await writeYamlDocumentFile(filePath, parsed);
  return { path: filePath };
}

export const ArtifactMutation = {
  kind: "ArtifactMutation",
  schema,
  new: newArtifactMutation,
  read: readArtifactMutation,
  write: writeArtifactMutation,
};
