import { access, constants, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { consumesOf } from "./transform/source-order.js";
import type { ImportArtifactKind } from "../shared/io/index.js";

export type SourcePhase = "acquire" | "transform";

export type SourceDescription = {
  id: string;
  description?: string;
  phases: SourcePhase[];
  produces?: readonly ImportArtifactKind[];
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

// Lenient read for the catalog; the run path is where invalid produces fails loud.
async function readPhaseProduces(
  modulePath: string,
): Promise<readonly ImportArtifactKind[] | undefined> {
  const module = (await import(pathToFileURL(modulePath).href)) as {
    produces?: unknown;
  };
  return Array.isArray(module.produces) &&
    module.produces.every((kind) => typeof kind === "string")
    ? (module.produces as ImportArtifactKind[])
    : undefined;
}

/**
 * Enumerate the sources under `sourcesRoot`, deriving each one's supported
 * phases from the presence of its phase modules (transform.ts is required and
 * defines a source; acquire.ts is optional) and its human description from the
 * phase module's optional `description` export — so the catalog is generated
 * from the sources themselves and cannot drift from a separate list.
 */
export async function describeSources(
  sourcesRoot: string,
): Promise<SourceDescription[]> {
  const entries = await readdir(sourcesRoot, { withFileTypes: true });
  const sources: SourceDescription[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transformPath = path.join(sourcesRoot, entry.name, "transform.ts");
    if (!(await fileExists(transformPath))) continue;
    const acquirePath = path.join(sourcesRoot, entry.name, "acquire.ts");
    const phases: SourcePhase[] = [];
    if (await fileExists(acquirePath)) phases.push("acquire");
    phases.push("transform");
    sources.push({
      id: entry.name,
      description:
        (await readPhaseDescription(transformPath)) ??
        ((await fileExists(acquirePath))
          ? await readPhaseDescription(acquirePath)
          : undefined),
      phases,
      produces: await readPhaseProduces(transformPath),
    });
  }
  sources.sort((left, right) => left.id.localeCompare(right.id));
  return sources;
}

export function renderSourceCatalog(sources: SourceDescription[]): string {
  if (sources.length === 0) return "No sources found under sources/.\n";
  return `${sources
    .map((source) => {
      const lines = [`${source.id}  [${source.phases.join(", ")}]`];
      if (source.description !== undefined)
        lines.push(`    ${source.description}`);
      if (source.produces !== undefined && source.produces.length > 0) {
        lines.push(`    produces: ${source.produces.join(", ")}`);
        const consumes = consumesOf(source.produces);
        if (consumes.length > 0) {
          lines.push(`    consumes: ${consumes.join(", ")}`);
        }
      }
      return lines.join("\n");
    })
    .join("\n")}\n`;
}
