import { access, constants, readdir } from "node:fs/promises";
import path from "node:path";

async function isSourceDir(dir: string): Promise<boolean> {
  try {
    await access(path.join(dir, "run.ts"), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Translates a shell-style glob (`*`, `?`) into an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  const pattern = Array.from(glob)
    .map((ch) =>
      ch === "*"
        ? ".*"
        : ch === "?"
          ? "."
          : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${pattern}$`);
}

/**
 * Source folder names under `sources/` matching the glob, sorted by id — only
 * folders that are actually sources (a `run.ts` defines a source), so a shared
 * helper dir like `sources/lib/` is never treated as a source. Callers that
 * need a dependency-correct run order sort the matched set through
 * `planSourceOrder` (ADR 0021); this only resolves the glob.
 */
export async function matchSourceIds(
  sourcesRoot: string,
  glob: string,
): Promise<string[]> {
  const entries = await readdir(sourcesRoot, { withFileTypes: true });
  const matcher = globToRegExp(glob);
  const candidates = entries
    .filter((entry) => entry.isDirectory() && matcher.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const sourceFlags = await Promise.all(
    candidates.map((id) => isSourceDir(path.join(sourcesRoot, id))),
  );
  return candidates.filter((_, index) => sourceFlags[index]);
}
