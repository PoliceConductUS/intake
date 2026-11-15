import { discoverSources } from "./source-discovery.js";

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

export async function matchSourceIds(
  sourcesRoot: string,
  glob: string,
  operations: readonly ("acquire" | "transform")[],
): Promise<string[]> {
  const matcher = globToRegExp(glob);
  return (await discoverSources(sourcesRoot))
    .filter(
      (source) =>
        matcher.test(source.id) &&
        operations.some((operation) => source.phases.includes(operation)),
    )
    .map((source) => source.id);
}
