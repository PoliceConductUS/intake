import { stat } from "node:fs/promises";
import { z } from "zod";
import { stableJson, typedInputFingerprint } from "./fingerprint.js";
import { INTAKE_API_VERSION } from "./intake-api-version.js";
import { firstIssuePath, yamlResourcePath } from "./resource.js";
import {
  readYamlDocumentFile,
  writeYamlDocumentFile,
} from "./internal/yaml-document.js";

const text = z.string().min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const SECRET_NAME =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|token|password|secret)$/i;

function holdsSecretName(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsSecretName);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, item]) => SECRET_NAME.test(key) || holdsSecretName(item),
  );
}

function urlHoldsSecret(value: string): boolean {
  const url = new URL(value);
  return (
    url.username !== "" ||
    url.password !== "" ||
    [...url.searchParams.keys()].some((key) => SECRET_NAME.test(key))
  );
}

const requestSchema = z
  .object({
    service: text,
    operation: text,
    url: z
      .url({ protocol: /^https?$/ })
      .refine((value) => !urlHoldsSecret(value), "A request holds no key.")
      .optional(),
    parameters: z
      .record(z.string(), z.unknown())
      .refine((value) => !holdsSecretName(value), "A request holds no key.")
      .optional(),
    prompt: text.optional(),
    inputs: z.array(z.object({ name: text, sha256 }).strict()).optional(),
  })
  .strict();

const outcomeSchema = z
  .object({
    status: z.enum(["succeeded", "failed"]),
    startedAt: timestamp,
    completedAt: timestamp,
    response: z.unknown().optional(),
    file: sha256.optional(),
    error: z
      .object({ kind: z.enum(["item", "service"]), message: text })
      .strict()
      .optional(),
    httpStatus: z.number().int().optional(),
    requestId: text.optional(),
    stopReason: text.optional(),
    requestedModel: text.optional(),
    model: text.optional(),
    usage: z.record(z.string(), z.unknown()).optional(),
    retryAfter: timestamp.optional(),
    producedBy: text.optional(),
    commandId: text,
    intakeVersion: text,
  })
  .strict()
  .superRefine((outcome, context) => {
    const answers =
      Number(outcome.response !== undefined) +
      Number(outcome.file !== undefined);
    if (outcome.status === "succeeded") {
      if (outcome.error !== undefined)
        context.addIssue({
          code: "custom",
          path: ["error"],
          message: "A succeeded outcome has no error.",
        });
      if (answers !== 1)
        context.addIssue({
          code: "custom",
          path: ["response"],
          message: "A succeeded outcome has a response or a file.",
        });
      return;
    }
    if (outcome.error === undefined)
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "A failed outcome has an error.",
      });
    if (answers !== 0)
      context.addIssue({
        code: "custom",
        path: [outcome.response !== undefined ? "response" : "file"],
        message: "A failed outcome has no response and no file.",
      });
  });

export type CallRequest = z.infer<typeof requestSchema>;
export type CallOutcome = z.infer<typeof outcomeSchema>;

export function callRequestFingerprint(request: CallRequest): string {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success)
    throw new Error(
      `CallResult request is malformed at ${firstIssuePath(parsed.error)}.`,
    );
  return typedInputFingerprint(JSON.parse(JSON.stringify(parsed.data)));
}

const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("CallResult"),
    metadata: z.object({ name: sha256, namespace: text }).strict(),
    spec: z
      .object({
        request: requestSchema,
        outcomes: z.array(outcomeSchema).min(1),
      })
      .strict(),
  })
  .strict()
  .refine(
    (envelope) =>
      envelope.metadata.name ===
      typedInputFingerprint(JSON.parse(JSON.stringify(envelope.spec.request))),
    {
      path: ["metadata", "name"],
      message: "The name is the fingerprint of the request.",
    },
  );

export type CallResultEnvelope = z.infer<typeof schema>;
export type CallResultInput = Omit<CallResultEnvelope, "apiVersion" | "kind">;

function parseCallResult(value: unknown): CallResultEnvelope {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `CallResult is malformed at ${firstIssuePath(result.error)}.`,
    );
  }
  return result.data;
}

async function readCallResult(filePath: string): Promise<CallResultEnvelope> {
  return parseCallResult(
    (await readYamlDocumentFile(filePath, "CallResult")).document,
  );
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export const CallResult = {
  kind: "CallResult",
  schema,
  new(input: CallResultInput): CallResultEnvelope {
    return parseCallResult({
      apiVersion: INTAKE_API_VERSION,
      kind: "CallResult",
      ...input,
    });
  },
  read: readCallResult,
  async write(
    directory: string,
    envelope: CallResultEnvelope,
  ): Promise<{ path: string }> {
    const parsed = parseCallResult(envelope);
    const filePath = yamlResourcePath(directory, parsed);
    if (await exists(filePath)) {
      const earlier = (await readCallResult(filePath)).spec.outcomes;
      const kept = parsed.spec.outcomes.slice(0, earlier.length);
      if (stableJson(kept) !== stableJson(earlier))
        throw new Error(
          `CallResult write would drop or change earlier outcomes: ${filePath}`,
        );
    }
    await writeYamlDocumentFile(filePath, parsed);
    return { path: filePath };
  },
};
