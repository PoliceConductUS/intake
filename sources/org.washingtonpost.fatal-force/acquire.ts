import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SourceAcquire } from "../../src/cli/transform/source-transform.js";
import {
  COMMIT,
  FILES,
  fileUrl,
  digest,
  readEvidence,
  Provenance,
} from "./evidence.js";
async function hasProvenance(dir: string) {
  try {
    await readFile(path.join(dir, "provenance.json"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
export const acquire: SourceAcquire = async ({
  sourceDir,
  previousSourceDirs = [],
  env,
}) => {
  const commit = env.FATAL_FORCE_COMMIT ?? COMMIT;
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error("FATAL_FORCE_COMMIT must be a full lowercase commit SHA");
  await mkdir(sourceDir, { recursive: true });
  for (const dir of [sourceDir, ...previousSourceDirs]) {
    if (!(await hasProvenance(dir))) continue;
    const evidence = await readEvidence(dir);
    if (evidence[FILES[0]].commit !== commit) {
      if (dir === sourceDir)
        throw new Error("Use a new acquisition directory for a changed commit");
      continue;
    }
    if (dir !== sourceDir) {
      for (const file of [...FILES, "provenance.json"])
        await copyFile(path.join(dir, file), path.join(sourceDir, file));
    }
    return;
  }
  const evidence: Record<string, unknown> = {};
  for (const file of FILES) {
    const sourceUrl = fileUrl(commit, file);
    const response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(
        `Fatal Force download failed: ${response.status} ${sourceUrl}`,
      );
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(path.join(sourceDir, file), bytes);
    evidence[file] = {
      sourceUrl,
      commit,
      sha256: digest(bytes),
      byteLength: bytes.length,
      retrievedAt: new Date().toISOString(),
    };
  }
  await writeFile(
    path.join(sourceDir, "provenance.json"),
    JSON.stringify(Provenance.parse(evidence), null, 2) + "\n",
  );
};
