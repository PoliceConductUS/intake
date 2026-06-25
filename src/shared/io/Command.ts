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
    kind: z.literal("Command"),
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
        statePath: nonEmptyString,
        path: nonEmptyString,
        sharedIoRoot: nonEmptyString,
        args: z.array(z.string().trim()).default([]),
      })
      .strict(),
  })
  .strict();

export type CommandEnvelope = z.infer<typeof schema>;
export type CommandInput = Omit<CommandEnvelope, "apiVersion" | "kind">;

type EnvelopeReadOptions = {
  expectedNamespace?: string;
  expectedSha256?: string;
};

function parseCommand(value: unknown): CommandEnvelope {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Command is malformed at ${firstIssuePath(result.error)}.`);
  }
  return result.data;
}

function newCommand(input: CommandInput): CommandEnvelope {
  return parseCommand({
    apiVersion: INTAKE_API_VERSION,
    kind: "Command",
    ...input,
  });
}

async function readCommand(
  filePath: string,
  options: EnvelopeReadOptions = {},
): Promise<CommandEnvelope> {
  const { contents, document } = await readYamlDocumentFile(
    filePath,
    "Command",
  );
  if (
    options.expectedSha256 !== undefined &&
    yamlDigest(contents) !== options.expectedSha256
  ) {
    throw new Error(`Command sha256 mismatch: ${filePath}`);
  }
  const envelope = parseCommand(document);
  if (
    options.expectedNamespace !== undefined &&
    envelope.metadata.namespace !== options.expectedNamespace
  ) {
    throw new Error(
      `Command namespace ${envelope.metadata.namespace} does not match expected namespace ${options.expectedNamespace}: ${filePath}`,
    );
  }
  return envelope;
}

async function writeCommand(
  directory: string,
  envelope: CommandEnvelope,
): Promise<{ path: string; sha256: string }> {
  const parsed = parseCommand(envelope);
  const filePath = yamlResourcePath(directory, parsed);
  const contents = await writeYamlDocumentFile(filePath, parsed);
  return { path: filePath, sha256: yamlDigest(contents) };
}

export const Command = {
  kind: "Command",
  schema,
  new: newCommand,
  read: readCommand,
  write: writeCommand,
};

export const read = readCommand;
export const write = writeCommand;
