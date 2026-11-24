import { readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { IntakeSource } from "./intake-source.js";
import { assertValidSourceId } from "../shared/source-namespace.js";
import { sourceNamespace } from "./source-namespace.js";
import { requestDefinitionSchema } from "./requests/lifecycle.js";
import { IMPORT_ARTIFACT_KINDS } from "../shared/io/import-type-metadata.js";
import { firstIssuePath } from "../shared/io/resource.js";

const IMPORT_ARTIFACT_KIND_SET: ReadonlySet<string> = new Set(
  IMPORT_ARTIFACT_KINDS,
);

const marker = "intake.source.ts";
const phaseNames = ["acquire", "transform", "request", "daily"] as const;
export type SourcePhase = (typeof phaseNames)[number];

export async function loadIntakeSource(
  sourceId: string,
  root: string,
): Promise<IntakeSource> {
  assertValidSourceId(sourceId);
  const file = path.join(root, sourceId, marker);
  const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  });
  if (!stat?.isFile())
    throw Error(`Unknown source id: missing ${marker} at ${file}`);
  const { source } = await import(pathToFileURL(file).href);
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw Error(
      `Source ${sourceId}: intake.source.ts must export a source object.`,
    );
  for (const phase of ["acquire", "transform", "daily"] as const) {
    if (source[phase] !== undefined && typeof source[phase] !== "function")
      throw Error(`Source ${sourceId}: ${phase} must be a function.`);
  }
  if ((source.transform === undefined) !== (source.produces === undefined))
    throw Error(
      `Source ${sourceId}: transform and produces must be declared together.`,
    );
  if (source.produces !== undefined) {
    if (!Array.isArray(source.produces))
      throw Error(`Source ${sourceId} must declare a produces array`);
    for (const kind of source.produces) {
      if (!IMPORT_ARTIFACT_KIND_SET.has(kind))
        throw Error(
          `Source ${sourceId} produces an unknown kind: ${String(kind)}`,
        );
    }
  }
  if (source.request !== undefined) {
    const request = requestDefinitionSchema.safeParse(source.request);
    if (!request.success)
      throw Error(
        `Source ${sourceId}: request is malformed at ${firstIssuePath(request.error)}.`,
      );
  }
  return source as IntakeSource;
}

export async function discoverSources(root: string) {
  const sources: { id: string; phases: SourcePhase[]; source: IntakeSource }[] =
    [];
  async function visit(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === marker)) {
      const id = sourceNamespace(root, directory);
      const source = await loadIntakeSource(id, root);
      sources.push({
        id,
        source,
        phases: phaseNames.filter((phase) => source[phase] !== undefined),
      });
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await visit(path.join(directory, entry.name));
    }
  }
  await visit(root);
  return sources.sort((a, b) => a.id.localeCompare(b.id));
}
