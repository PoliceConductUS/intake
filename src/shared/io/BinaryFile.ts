import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { INTAKE_API_VERSION } from "./intake-api-version.js";
import { firstIssuePath, yamlResourcePath } from "./resource.js";
import {
  readYamlDocumentFile,
  writeYamlDocumentFile,
} from "./internal/yaml-document.js";

const text = z.string().min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });

const originSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("download"),
      url: z.url({ protocol: /^https?$/ }),
      retrievedAt: timestamp,
      httpStatus: z.number().int(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("local"),
      filename: text,
      importedAt: timestamp,
    })
    .strict(),
]);

const schema = z
  .object({
    apiVersion: z.literal(INTAKE_API_VERSION),
    kind: z.literal("BinaryFile"),
    metadata: z.object({ name: sha256, namespace: text }).strict(),
    spec: z
      .object({
        sha256,
        bytes: z.number().int().nonnegative(),
        contentType: text,
        extension: z.string().regex(/^[a-z0-9]+$/),
        origin: originSchema,
      })
      .strict(),
  })
  .strict()
  .refine((envelope) => envelope.metadata.name === envelope.spec.sha256, {
    path: ["metadata", "name"],
    message: "The name is the SHA-256 of the file.",
  });

export type BinaryFileEnvelope = z.infer<typeof schema>;
export type BinaryFileInput = Omit<BinaryFileEnvelope, "apiVersion" | "kind">;
export type BinaryFileOrigin = z.infer<typeof originSchema>;
export type StoredBinaryFile = {
  envelope: BinaryFileEnvelope;
  bytes: Buffer;
  filePath: string;
};

function parseBinaryFile(value: unknown): BinaryFileEnvelope {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `BinaryFile is malformed at ${firstIssuePath(result.error)}.`,
    );
  }
  return result.data;
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesPath(directory: string, envelope: BinaryFileEnvelope): string {
  return path.join(
    directory,
    `${envelope.spec.sha256}.${envelope.spec.extension}`,
  );
}

async function readIfPresent(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function isPresent(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readBinaryFile(envelopePath: string): Promise<StoredBinaryFile> {
  const envelope = parseBinaryFile(
    (await readYamlDocumentFile(envelopePath, "BinaryFile")).document,
  );
  const filePath = bytesPath(path.dirname(envelopePath), envelope);
  const bytes = await readIfPresent(filePath);
  if (bytes === undefined)
    throw new Error(`BinaryFile envelope has no file: ${filePath}`);
  if (hash(bytes) !== envelope.spec.sha256)
    throw new Error(`BinaryFile does not hash to its name: ${filePath}`);
  if (bytes.length !== envelope.spec.bytes)
    throw new Error(
      `BinaryFile byte count does not match its file: ${filePath}`,
    );
  return { envelope, bytes, filePath };
}

export const BinaryFile = {
  kind: "BinaryFile",
  schema,
  new(input: BinaryFileInput): BinaryFileEnvelope {
    return parseBinaryFile({
      apiVersion: INTAKE_API_VERSION,
      kind: "BinaryFile",
      ...input,
    });
  },
  read: readBinaryFile,
  async write(
    directory: string,
    envelope: BinaryFileEnvelope,
    bytes: Buffer,
  ): Promise<{ path: string; filePath: string }> {
    const parsed = parseBinaryFile(envelope);
    const envelopePath = yamlResourcePath(directory, parsed);
    const filePath = bytesPath(directory, parsed);
    if (hash(bytes) !== parsed.spec.sha256)
      throw new Error(
        `BinaryFile bytes do not hash to the name ${parsed.spec.sha256}.`,
      );
    if (bytes.length !== parsed.spec.bytes)
      throw new Error(
        `BinaryFile ${parsed.spec.sha256} states ${parsed.spec.bytes} bytes for ${bytes.length}.`,
      );
    const existing = await readIfPresent(filePath);
    if (existing !== undefined && !existing.equals(bytes))
      throw new Error(
        `BinaryFile name is taken by different bytes: ${filePath} holds a file with SHA-256 ${hash(existing)}, not ${parsed.spec.sha256}.`,
      );
    await mkdir(directory, { recursive: true });
    if (existing === undefined) {
      await writeFile(`${filePath}.tmp`, bytes);
      await rename(`${filePath}.tmp`, filePath);
    }
    if (!(await isPresent(envelopePath))) {
      await writeYamlDocumentFile(`${envelopePath}.tmp`, parsed);
      await rename(`${envelopePath}.tmp`, envelopePath);
    }
    return { path: envelopePath, filePath };
  },
};
