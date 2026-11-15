import { discoverSources, type SourcePhase } from "./source-discovery.js";
import { consumesOf } from "./transform/source-order.js";
import type { ImportArtifactKind } from "../shared/io/index.js";

export type { SourcePhase } from "./source-discovery.js";

export type SourceDescription = {
  id: string;
  description?: string;
  phases: SourcePhase[];
  produces?: readonly ImportArtifactKind[];
};

export async function describeSources(
  sourcesRoot: string,
): Promise<SourceDescription[]> {
  return (await discoverSources(sourcesRoot)).map(({ id, phases, source }) => ({
    id,
    phases,
    description: source.description,
    produces: source.produces,
  }));
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
