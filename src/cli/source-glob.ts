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

// Glob-matched source folders (those with run.ts, so sources/lib/ is not one),
// sorted by id. Run order is applied separately via planSourceOrder (ADR 0021).
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
