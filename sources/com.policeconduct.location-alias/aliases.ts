import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// A curated location alias: a mistaken/alternate location path that resolves to a
// canonical one. location_path_id carries the canonical path; import resolves it
// to a real location_path (resolve-or-fail).
export type AliasEntry = { alias_path: string; location_path_id: string };

// One immutable output in the append-only chain: the full alias list plus a
// reference to the previous output (its path + sha256), so any later edit to a
// prior output is detectable by walking the chain.
export type AliasOutput = {
  previous: { path: string; sha256: string } | null;
  aliases: AliasEntry[];
};

const CHAIN_DIR = "location-aliases";
const LATEST = "latest.json";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The location path (`/state/county/place/`) of a URL or an already-bare path. */
export function locationPathFromUrl(input: string): string {
  const trimmed = input.trim();
  let pathname = trimmed;
  try {
    pathname = new URL(trimmed).pathname;
  } catch {
    // not a full URL; treat the input as the path itself
  }
  const inner = pathname.replace(/^\/+|\/+$/g, "");
  return inner === "" ? "/" : `/${inner}/`;
}

type LatestPointer = { path: string; sha256: string };

function chainDir(stateDir: string): string {
  return path.join(stateDir, CHAIN_DIR);
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/**
 * The latest alias output in the chain, verified against the pointer's sha (a
 * mismatch means an output was edited out of band — fail loud). An empty chain
 * yields an output with no aliases and no previous.
 */
export async function readLatestAliases(
  stateDir: string,
): Promise<AliasOutput> {
  const pointer = await readJson<LatestPointer>(
    path.join(chainDir(stateDir), LATEST),
  );
  if (pointer === undefined) {
    return { previous: null, aliases: [] };
  }
  const outputPath = path.join(chainDir(stateDir), pointer.path);
  const raw = await readFile(outputPath, "utf8");
  if (sha256(raw) !== pointer.sha256) {
    throw new Error(
      `com.policeconduct.location-alias: ${pointer.path} sha mismatch (edited out of band); expected ${pointer.sha256}.`,
    );
  }
  return JSON.parse(raw) as AliasOutput;
}

/**
 * Append one alias to the chain: read the current latest, add the entry (dedup by
 * alias_path — a repeated alias updates its target), and write the next immutable
 * output referencing the previous one's path + sha, then move the latest pointer.
 * Returns the new output.
 */
export async function appendAlias(
  stateDir: string,
  entry: AliasEntry,
): Promise<AliasOutput> {
  const dir = chainDir(stateDir);
  await mkdir(dir, { recursive: true });
  const pointer = await readJson<LatestPointer>(path.join(dir, LATEST));
  const current = await readLatestAliases(stateDir);

  const aliases = [
    ...current.aliases.filter((a) => a.alias_path !== entry.alias_path),
    entry,
  ].sort((a, b) => a.alias_path.localeCompare(b.alias_path));

  const next: AliasOutput = {
    previous:
      pointer === undefined
        ? null
        : { path: pointer.path, sha256: pointer.sha256 },
    aliases,
  };

  // Name each output by its own content hash so it is immutable and collisions
  // between chains are impossible.
  const body = `${JSON.stringify(next, null, 2)}\n`;
  const digest = sha256(body);
  const fileName = `${digest}.json`;
  await writeFile(path.join(dir, fileName), body);
  await writeFile(
    path.join(dir, LATEST),
    `${JSON.stringify({ path: fileName, sha256: digest }, null, 2)}\n`,
  );
  return next;
}
