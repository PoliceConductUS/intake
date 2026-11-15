import { loadIntakeSource } from "../source-discovery.js";
export { assertValidSourceId } from "../../shared/source-namespace.js";
import {
  IMPORT_ARTIFACT_KINDS,
  type ImportArtifactKind,
} from "../../shared/io/import-type-metadata.js";
import type { SourceTransform, SourceAcquire } from "./source-transform.js";

const IMPORT_ARTIFACT_KIND_SET: ReadonlySet<string> = new Set(
  IMPORT_ARTIFACT_KINDS,
);

export async function loadSourceModule(
  sourceId: string,
  sourcesRoot: string,
): Promise<SourceTransform> {
  const { transform } = await loadIntakeSource(sourceId, sourcesRoot);
  if (!transform) throw Error(`Source ${sourceId} does not support transform`);
  return transform;
}

export async function loadSourceProduces(
  sourceId: string,
  sourcesRoot: string,
): Promise<ImportArtifactKind[]> {
  const { produces } = await loadIntakeSource(sourceId, sourcesRoot);
  if (!Array.isArray(produces))
    throw Error(`Source ${sourceId} must declare a produces array`);
  for (const kind of produces) {
    if (!IMPORT_ARTIFACT_KIND_SET.has(kind))
      throw Error(
        `Source ${sourceId} produces an unknown kind: ${String(kind)}`,
      );
  }
  return [...produces];
}

export async function loadSourceStandalone(
  sourceId: string,
  sourcesRoot: string,
): Promise<boolean> {
  return (await loadIntakeSource(sourceId, sourcesRoot)).standalone === true;
}

export async function findSourceAcquire(
  sourceId: string,
  sourcesRoot: string,
): Promise<SourceAcquire | undefined> {
  return (await loadIntakeSource(sourceId, sourcesRoot)).acquire;
}

export async function loadSourceAcquire(
  sourceId: string,
  sourcesRoot: string,
): Promise<SourceAcquire> {
  const acquire = await findSourceAcquire(sourceId, sourcesRoot);
  if (!acquire) throw Error(`Source ${sourceId} does not support acquire`);
  return acquire;
}
