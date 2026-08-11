import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { listZipEntries, readZipEntryBuffer } from "../../../src/cli/run/parse/zip.js";

/**
 * Rewire helper for `tiger-hierarchy.ts` (Phase-2 Task 4). The original
 * standalone producer (`intake.census-gazetteer/src/run.js`) extracted the
 * whole TIGER archive to a directory (via `extractArchivesForCallback`)
 * before handing a plain `.shp` path to `readFeaturesByState`. The new
 * runtime hands sources their input files as archive paths directly
 * (discovery/download are out of scope here), so `readFeaturesByState` now
 * receives a TIGER `.zip` path and must extract it itself.
 *
 * Extracts every `.shp`/`.dbf`/`.shx` entry from a TIGER zip into a temp
 * directory under the run's `state` directory, so the Phase-1
 * `readShapefile` (which reads from filesystem paths) can read it — it
 * resolves the sibling `.dbf` automatically by replacing the `.shp`
 * extension, which works because both are extracted into the same
 * directory with matching basenames. Returns the path to the extracted
 * `.shp` file. Deterministic: no network, clock, or randomness.
 */
export async function extractShapefileFromZip(
  zipPath: string,
  state: string,
): Promise<string> {
  const zipBase = path.basename(zipPath, path.extname(zipPath));
  const destinationDir = path.join(state, "tmp", zipBase);
  await mkdir(destinationDir, { recursive: true });

  const entries = await listZipEntries(zipPath);
  const shapefileEntries = entries.filter((entryName) =>
    /\.(shp|dbf|shx)$/i.test(entryName),
  );

  let shpPath: string | undefined;
  for (const entryName of shapefileEntries) {
    const buffer = await readZipEntryBuffer(zipPath, entryName);
    const destinationPath = path.join(
      destinationDir,
      path.basename(entryName),
    );
    await writeFile(destinationPath, buffer);
    if (/\.shp$/i.test(entryName)) shpPath = destinationPath;
  }

  if (shpPath === undefined) {
    throw new Error(`No .shp entry found in zip: ${zipPath}`);
  }

  return shpPath;
}
