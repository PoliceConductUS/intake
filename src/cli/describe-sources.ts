import { access, constants, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type SourcePhase = "acquire" | "run";

export type SourceDescription = {
  id: string;
  description?: string;
  phases: SourcePhase[];
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readPhaseDescription(
  modulePath: string,
): Promise<string | undefined> {
  const module = (await import(pathToFileURL(modulePath).href)) as {
    description?: unknown;
  };
  return typeof module.description === "string"
    ? module.description
    : undefined;
}

/**
 * Enumerate the sources under `sourcesRoot`, deriving each one's supported
 * phases from the presence of its phase modules (run.ts is required and defines
 * a source; acquire.ts is optional) and its human description from the phase
 * module's optional `description` export — so the catalog is generated from the
 * sources themselves and cannot drift from a separate list.
 */
export async function describeSources(
  sourcesRoot: string,
): Promise<SourceDescription[]> {
  const entries = await readdir(sourcesRoot, { withFileTypes: true });
  const sources: SourceDescription[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runPath = path.join(sourcesRoot, entry.name, "run.ts");
    if (!(await fileExists(runPath))) continue;
    const acquirePath = path.join(sourcesRoot, entry.name, "acquire.ts");
    const phases: SourcePhase[] = [];
    if (await fileExists(acquirePath)) phases.push("acquire");
    phases.push("run");
    sources.push({
      id: entry.name,
      description:
        (await readPhaseDescription(runPath)) ??
        ((await fileExists(acquirePath))
          ? await readPhaseDescription(acquirePath)
          : undefined),
      phases,
    });
  }
  sources.sort((left, right) => left.id.localeCompare(right.id));
  return sources;
}

export function renderSourceCatalog(sources: SourceDescription[]): string {
  if (sources.length === 0) return "No sources found under sources/.\n";
  return `${sources
    .map((source) => {
      const header = `${source.id}  [${source.phases.join(", ")}]`;
      return source.description === undefined
        ? header
        : `${header}\n    ${source.description}`;
    })
    .join("\n")}\n`;
}
