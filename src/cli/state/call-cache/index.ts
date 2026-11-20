import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  BinaryFile,
  type BinaryFileOrigin,
  type StoredBinaryFile,
} from "../../../shared/io/BinaryFile.js";
import {
  CallResult,
  callRequestFingerprint,
  type CallOutcome,
  type CallRequest,
  type CallResultEnvelope,
} from "../../../shared/io/CallResult.js";
import { yamlResourceFileName } from "../../../shared/io/resource.js";
import type { CallCache } from "../../../shared/services/client-base.js";
import { assertValidSourceId } from "../../../shared/source-namespace.js";

export type CallCacheLocation = { rootDir: string; namespace: string };

function kindDirectory(
  location: CallCacheLocation,
  kind: "CallResult" | "BinaryFile",
): string {
  assertValidSourceId(location.namespace);
  return path.join(
    location.rootDir,
    "state",
    "intake",
    "namespaces",
    location.namespace,
    kind,
  );
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function readCallResult(
  location: CallCacheLocation,
  request: CallRequest,
): Promise<CallResultEnvelope | undefined> {
  const filePath = path.join(
    kindDirectory(location, "CallResult"),
    yamlResourceFileName(callRequestFingerprint(request), "CallResult"),
  );
  if (!(await isFile(filePath))) return undefined;
  const envelope = await CallResult.read(filePath);
  if (envelope.metadata.namespace !== location.namespace)
    throw new Error(
      `CallResult namespace ${envelope.metadata.namespace} does not match ${location.namespace}: ${filePath}`,
    );
  return envelope;
}

export async function appendOutcome(
  location: CallCacheLocation,
  request: CallRequest,
  outcome: CallOutcome,
): Promise<CallResultEnvelope> {
  const existing = await readCallResult(location, request);
  const envelope = CallResult.new({
    metadata: {
      name: callRequestFingerprint(request),
      namespace: location.namespace,
    },
    spec: {
      request: existing?.spec.request ?? request,
      outcomes: [...(existing?.spec.outcomes ?? []), outcome],
    },
  });
  await CallResult.write(kindDirectory(location, "CallResult"), envelope);
  return envelope;
}

// ADR 0039, decision 3. With `keepSucceeded` (`data reset --no-acquire`) a
// successful outcome stands whatever its `retryAfter`.
export function standingOutcome(
  envelope: CallResultEnvelope | undefined,
  now: Date,
  options: { keepSucceeded?: boolean } = {},
): CallOutcome | undefined {
  if (envelope === undefined) return undefined;
  if (options.keepSucceeded === true) {
    const succeeded = [...envelope.spec.outcomes]
      .reverse()
      .find((outcome) => outcome.status === "succeeded");
    if (succeeded !== undefined) return succeeded;
  }
  const current = envelope.spec.outcomes.at(-1);
  if (current === undefined) return undefined;
  if (
    current.retryAfter !== undefined &&
    Date.parse(current.retryAfter) <= now.getTime()
  )
    return undefined;
  return current;
}

export async function readBinaryFile(
  location: CallCacheLocation,
  sha256: string,
): Promise<StoredBinaryFile | undefined> {
  if (!/^[a-f0-9]{64}$/.test(sha256))
    throw new Error(`Not a SHA-256: ${sha256}`);
  const directory = kindDirectory(location, "BinaryFile");
  const envelopeName = yamlResourceFileName(sha256, "BinaryFile");
  const envelopePath = path.join(directory, envelopeName);
  if (await isFile(envelopePath)) {
    const stored = await BinaryFile.read(envelopePath);
    if (stored.envelope.metadata.namespace !== location.namespace)
      throw new Error(
        `BinaryFile namespace ${stored.envelope.metadata.namespace} does not match ${location.namespace}: ${envelopePath}`,
      );
    return stored;
  }
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const orphan = names.find(
    (name) => name.startsWith(`${sha256}.`) && !name.endsWith(".tmp"),
  );
  if (orphan !== undefined)
    throw new Error(
      `BinaryFile file has no envelope: ${path.join(directory, orphan)}`,
    );
  return undefined;
}

export async function writeBinaryFile(
  location: CallCacheLocation,
  input: {
    bytes: Buffer;
    contentType: string;
    extension: string;
    origin: BinaryFileOrigin;
  },
): Promise<StoredBinaryFile> {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const directory = kindDirectory(location, "BinaryFile");
  if (
    await isFile(
      path.join(directory, yamlResourceFileName(sha256, "BinaryFile")),
    )
  ) {
    const stored = await readBinaryFile(location, sha256);
    if (stored !== undefined) {
      if (!stored.bytes.equals(input.bytes))
        throw new Error(
          `BinaryFile name is taken by different bytes: ${stored.filePath}`,
        );
      return stored;
    }
  }
  const { path: envelopePath } = await BinaryFile.write(
    directory,
    BinaryFile.new({
      metadata: { name: sha256, namespace: location.namespace },
      spec: {
        sha256,
        bytes: input.bytes.length,
        contentType: input.contentType,
        extension: input.extension,
        origin: input.origin,
      },
    }),
    input.bytes,
  );
  return BinaryFile.read(envelopePath);
}

export function createCallCache(
  location: CallCacheLocation & { keepSucceeded?: boolean },
): CallCache {
  return {
    readCallResult: (request) => readCallResult(location, request),
    appendOutcome: (request, outcome) =>
      appendOutcome(location, request, outcome),
    standingOutcome: (envelope, now) =>
      standingOutcome(envelope, now, {
        keepSucceeded: location.keepSucceeded,
      }),
    readBinaryFile: (sha256) => readBinaryFile(location, sha256),
    writeBinaryFile: (input) => writeBinaryFile(location, input),
  };
}
