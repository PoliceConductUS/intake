import { glob, stat, cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { createCommandDirectory } from "../command-directory.js";
import { writeCommandPointer } from "../state/command-pointer.js";

type CopyItem = { source: string; destinationRelative: string };

// A path carrying glob metacharacters is treated as a pattern to expand; one
// without them is a literal file/folder path (so a missing one is a typo).
function isGlob(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern);
}

// Recurse a directory into copy items, preserving each file's path relative to
// `base` and skipping dotfiles (mirrors how transform collects source inputs).
async function collectDirectory(
  directory: string,
  base: string,
): Promise<CopyItem[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const items: CopyItem[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      items.push(...(await collectDirectory(full, base)));
    } else if (entry.isFile()) {
      items.push({
        source: full,
        destinationRelative: path.relative(base, full),
      });
    }
  }
  return items;
}

/**
 * Resolve each `--from-local` argument — a file, a folder, or a glob — into a
 * flat copy plan. A file copies to its basename; a folder copies its files
 * preserving their structure beneath it; a glob expands (Node's built-in glob),
 * with file matches copied by basename and directory matches recursed. Fails
 * loud on an argument that matches nothing and on a destination-name collision,
 * so a mistyped path or two same-named inputs never silently drop data.
 */
export async function resolveLocalInputs(
  paths: readonly string[],
  cwd: string,
): Promise<CopyItem[]> {
  const items: CopyItem[] = [];
  for (const argument of paths) {
    const absolute = path.resolve(cwd, argument);
    const info = await stat(absolute).catch(() => undefined);
    if (info?.isFile()) {
      items.push({
        source: absolute,
        destinationRelative: path.basename(absolute),
      });
      continue;
    }
    if (info?.isDirectory()) {
      items.push(...(await collectDirectory(absolute, absolute)));
      continue;
    }
    // A plain path that does not exist is a typo, not a zero-match glob — say so.
    if (!isGlob(argument)) {
      throw new Error(`--from-local: no such file or folder: ${argument}`);
    }
    let matched = false;
    for await (const match of glob(argument, { cwd })) {
      matched = true;
      const matchAbsolute = path.resolve(cwd, match);
      const matchInfo = await stat(matchAbsolute);
      if (matchInfo.isFile()) {
        items.push({
          source: matchAbsolute,
          destinationRelative: path.basename(matchAbsolute),
        });
      } else if (matchInfo.isDirectory()) {
        items.push(...(await collectDirectory(matchAbsolute, matchAbsolute)));
      }
    }
    if (!matched) {
      throw new Error(`--from-local: glob matched nothing: ${argument}`);
    }
  }
  if (items.length === 0) {
    throw new Error("--from-local resolved no input files.");
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.destinationRelative)) {
      throw new Error(
        `--from-local inputs collide on destination name: ${item.destinationRelative}`,
      );
    }
    seen.add(item.destinationRelative);
  }
  return items;
}

export type AcquireFromLocalDeps = {
  env: Record<string, string | undefined>;
  workspace: string;
  state: string;
  cwd: string;
  createCommandDirectory: typeof createCommandDirectory;
  writeCommandPointer: typeof writeCommandPointer;
  logger: { info: (message: string) => void };
};

/**
 * Stage local files as a source's acquired inputs: copy the resolved file/folder/
 * glob into a fresh command's `<source-id>/output/` and point the `acquire`
 * command pointer at it — the same shape a real acquire produces, so `intake data transform`
 * consumes it identically (no source `acquire.ts` module required).
 */
export async function acquireFromLocal(
  sourceId: string,
  paths: readonly string[],
  deps: AcquireFromLocalDeps,
): Promise<void> {
  const items = await resolveLocalInputs(paths, deps.cwd);
  const { outputDirectory } = await deps.createCommandDirectory(deps.env, {
    namespace: sourceId,
    args: ["acquire", sourceId, "--from-local", ...paths],
  });
  for (const item of items) {
    const destination = path.join(outputDirectory, item.destinationRelative);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(item.source, destination);
  }
  const outputRelative = path.relative(deps.workspace, outputDirectory);
  await deps.writeCommandPointer(deps.state, "acquire", {
    latest: outputRelative,
  });
  deps.logger.info(
    `${sourceId}: staged ${items.length} local input file(s) at ${outputRelative}`,
  );
}
