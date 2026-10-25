import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import type { IdentityRestorationEnvelope } from "../../../shared/io/IdentityRestoration.js";
import { yamlResourceFileName } from "../../../shared/io/resource.js";
import { resolveSourceNameToCanonicalIdPath } from "./index.js";
import { SourceNameToCanonicalId } from "./SourceNameToCanonicalId.js";
import { CanonicalIdToSourceName } from "./CanonicalIdToSourceName.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readState(event: IdentityRestorationEnvelope, rootDir?: string) {
  const { namespace } = event.metadata;
  const { entityKind, sourceName, expectedCurrentId, originalId } = event.spec;
  const directory = path.join(
    resolveSourceNameToCanonicalIdPath(namespace, { rootDir }),
    entityKind,
  );
  const namespaces = path.dirname(
    resolveSourceNameToCanonicalIdPath(namespace, { rootDir }),
  );
  for (const other of await readdir(namespaces, { withFileTypes: true })) {
    if (!other.isDirectory() || other.name === namespace) continue;
    const otherReverse = path.join(
      namespaces,
      other.name,
      entityKind,
      yamlResourceFileName(expectedCurrentId, "CanonicalIdToSourceName"),
    );
    if (await exists(otherReverse)) {
      await CanonicalIdToSourceName.read(otherReverse, {
        expectedNamespace: other.name,
      });
      throw new Error(
        `Identity restoration erroneous ID is owned by another namespace: ${other.name}.`,
      );
    }
  }
  const forwardPath = path.join(
    directory,
    yamlResourceFileName(sourceName, "SourceNameToCanonicalId"),
  );
  const oldPath = path.join(
    directory,
    yamlResourceFileName(expectedCurrentId, "CanonicalIdToSourceName"),
  );
  const originalPath = path.join(
    directory,
    yamlResourceFileName(originalId, "CanonicalIdToSourceName"),
  );
  if (!(await exists(forwardPath)))
    throw new Error("Identity restoration mapping is missing.");
  const forward = await SourceNameToCanonicalId.read(forwardPath, {
    expectedNamespace: namespace,
  });
  if (
    forward.metadata.name !== sourceName ||
    forward.spec.kind !== entityKind ||
    ![expectedCurrentId, originalId].includes(forward.spec.canonicalId!)
  )
    throw new Error(
      "Identity restoration mapping does not match expected identity.",
    );
  for (const [filePath, id] of [
    [oldPath, expectedCurrentId],
    [originalPath, originalId],
  ]) {
    if (await exists(filePath!)) {
      const reverse = await CanonicalIdToSourceName.read(filePath!, {
        expectedNamespace: namespace,
      });
      if (
        reverse.metadata.name !== id ||
        reverse.spec.kind !== entityKind ||
        reverse.spec.sourceName !== sourceName
      )
        throw new Error(
          "Identity restoration original or current identity is occupied by another source.",
        );
    }
  }
  return {
    directory,
    forwardPath,
    oldPath,
    originalPath,
    currentId: forward.spec.canonicalId,
  };
}

export async function assertIdentityRestorationReady(
  event: IdentityRestorationEnvelope,
  rootDir?: string,
): Promise<void> {
  const state = await readState(event, rootDir);
  if (
    state.currentId !== event.spec.expectedCurrentId ||
    !(await exists(state.oldPath)) ||
    (await exists(state.originalPath))
  )
    throw new Error(
      "Identity restoration requires the expected current mapping and an unoccupied original identity.",
    );
}

export async function assertIdentityRestorationReplayable(
  event: IdentityRestorationEnvelope,
  rootDir?: string,
): Promise<void> {
  const state = await readState(event, rootDir);
  if (state.currentId === event.spec.expectedCurrentId)
    await assertIdentityRestorationReady(event, rootDir);
  else await assertIdentityRestorationComplete(event, rootDir);
}

export async function assertIdentityRestorationComplete(
  event: IdentityRestorationEnvelope,
  rootDir?: string,
): Promise<void> {
  const state = await readState(event, rootDir);
  if (
    state.currentId !== event.spec.originalId ||
    !(await exists(state.originalPath)) ||
    (await exists(state.oldPath))
  )
    throw new Error(
      "Identity restoration ledger is incomplete; run data up to recover.",
    );
}

// Called only after the immutable event's DB transaction is recorded applied.
// Each rename is atomic; any interrupted sequence is readable and repeatable.
export async function completeIdentityRestoration(
  event: IdentityRestorationEnvelope,
  rootDir?: string,
): Promise<void> {
  const state = await readState(event, rootDir);
  const { namespace } = event.metadata;
  const { sourceName, entityKind, originalId } = event.spec;
  await mkdir(state.directory, { recursive: true });
  const staging = await mkdtemp(
    path.join(state.directory, ".identity-restoration-"),
  );
  try {
    const forward = await SourceNameToCanonicalId.write(
      staging,
      SourceNameToCanonicalId.new({
        metadata: { name: sourceName, namespace },
        spec: { kind: entityKind, canonicalId: originalId },
      }),
    );
    const reverse = await CanonicalIdToSourceName.write(
      staging,
      CanonicalIdToSourceName.new({
        metadata: { name: originalId, namespace },
        spec: { kind: entityKind, sourceName },
      }),
    );
    await rename(forward.path, state.forwardPath);
    await rename(reverse.path, state.originalPath);
    if (await exists(state.oldPath)) await unlink(state.oldPath);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
