import { readdir } from "node:fs/promises";

const CENSUS_SOURCE_ID = "us-census-gazetteer";

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
 * Source folder names under `sources/` matching the glob, sorted, with
 * `us-census-gazetteer` first when present — it produces the shared `location_path`
 * concept every other source resolves against, so it must run first (ADR 0015).
 */
export async function matchSourceIds(
  sourcesRoot: string,
  glob: string,
): Promise<string[]> {
  const entries = await readdir(sourcesRoot, { withFileTypes: true });
  const matcher = globToRegExp(glob);
  const matched = entries
    .filter((entry) => entry.isDirectory() && matcher.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  matched.sort((a, b) =>
    a === CENSUS_SOURCE_ID ? -1 : b === CENSUS_SOURCE_ID ? 1 : 0,
  );
  return matched;
}
