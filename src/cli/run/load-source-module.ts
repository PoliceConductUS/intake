import { access, constants } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SourceRun, SourceAcquire } from "./source-run.js";

function assertValidSourceId(sourceId: string): void {
  if (!/^[a-z0-9][a-z0-9.\-]*$/i.test(sourceId)) {
    throw new Error(`Invalid source id: ${sourceId}`);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

// A source is a folder under sources/ defining phase modules named for the CLI
// verb that runs them: run.ts (produce) and the optional acquire.ts
// (download/scrape). run.ts is what makes the folder a source.
function sourcePhasePath(
  sourceId: string,
  sourcesRoot: string,
  phase: "run" | "acquire",
): string {
  return path.join(sourcesRoot, sourceId, `${phase}.ts`);
}

export async function loadSourceModule(
  sourceId: string,
  sourcesRoot: string,
): Promise<SourceRun> {
  assertValidSourceId(sourceId);
  const modulePath = sourcePhasePath(sourceId, sourcesRoot, "run");
  if (!(await fileExists(modulePath))) {
    throw new Error(`Unknown source id: no run module at ${modulePath}`);
  }
  const module = (await import(pathToFileURL(modulePath).href)) as {
    run?: unknown;
  };
  if (typeof module.run !== "function") {
    throw new Error(`Source ${sourceId} run.ts must export a run function`);
  }
  return module.run as SourceRun;
}

// Load a source's optional acquire (download/scrape) phase. A source with no
// acquire.ts is a valid source that simply does not support acquire.
export async function loadSourceAcquire(
  sourceId: string,
  sourcesRoot: string,
): Promise<SourceAcquire> {
  assertValidSourceId(sourceId);
  if (!(await fileExists(sourcePhasePath(sourceId, sourcesRoot, "run")))) {
    throw new Error(
      `Unknown source id: no run module at ${sourcePhasePath(sourceId, sourcesRoot, "run")}`,
    );
  }
  const modulePath = sourcePhasePath(sourceId, sourcesRoot, "acquire");
  if (!(await fileExists(modulePath))) {
    throw new Error(`Source ${sourceId} does not support acquire`);
  }
  const module = (await import(pathToFileURL(modulePath).href)) as {
    acquire?: unknown;
  };
  if (typeof module.acquire !== "function") {
    throw new Error(
      `Source ${sourceId} acquire.ts must export an acquire function`,
    );
  }
  return module.acquire as SourceAcquire;
}
