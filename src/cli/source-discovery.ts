import { readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { IntakeSource } from "./intake-source.js";
import { assertValidSourceId } from "../shared/source-namespace.js";
import { sourceNamespace } from "./source-namespace.js";

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
