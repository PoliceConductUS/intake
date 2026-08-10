import { access, constants } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SourceRun } from "./source-run.js";

export async function loadSourceModule(
  sourceId: string,
  sourcesRoot: string,
): Promise<SourceRun> {
  if (!/^[a-z0-9][a-z0-9.\-]*$/i.test(sourceId)) {
    throw new Error(`Invalid source id: ${sourceId}`);
  }
  const modulePath = path.join(sourcesRoot, sourceId, "config.ts");
  try {
    await access(modulePath, constants.R_OK);
  } catch {
    throw new Error(`Unknown source id: no source module at ${modulePath}`);
  }
  const module = (await import(pathToFileURL(modulePath).href)) as {
    run?: unknown;
  };
  if (typeof module.run !== "function") {
    throw new Error(`Source ${sourceId} config.ts must export a run function`);
  }
  return module.run as SourceRun;
}
