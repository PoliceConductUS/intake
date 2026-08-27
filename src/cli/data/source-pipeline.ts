import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import type { CommandResult } from "../../shared/cli/types.js";
import { intakeWorkspace } from "../command-directory.js";
import {
  buildRunSourceDeps,
  sourceInputDir,
  sourceInputPaths,
  transformSource,
} from "../run/index.js";
import {
  loadSourceProduces,
  loadSourceStandalone,
} from "../run/load-source-module.js";
import { planSourceOrder } from "../run/source-order.js";
import { matchSourceIds } from "../source-glob.js";
import { runImportArtifactsCommand } from "../import/artifacts/index.js";
import { generateEntry } from "./chain.js";

const SOURCES_ROOT = path.join(process.cwd(), "sources");
const SILENT = { info: () => {} };

// The newest `output/` file ending in `suffix` a source produced across all command
// runs — its latest transform Artifacts, or the DatabaseMutations an import just wrote.
async function newestSourceOutput(
  workspace: string,
  sourceId: string,
  suffix: string,
): Promise<string | undefined> {
  let best: string | undefined;
  let bestMtime = 0;
  const commandRoot = path.join(workspace, "command");
  for (const commandDir of await readdir(commandRoot).catch(() => [])) {
    const outputDir = path.join(commandRoot, commandDir, sourceId, "output");
    for (const file of await readdir(outputDir).catch(() => [])) {
      if (!file.endsWith(suffix)) continue;
      const filePath = path.join(outputDir, file);
      const mtime = (await stat(filePath)).mtimeMs;
      if (mtime > bestMtime) {
        bestMtime = mtime;
        best = filePath;
      }
    }
  }
  return best;
}

/**
 * `data transform <ns>`: run a source's run.ts against its latest acquired input to
 * produce and write its Artifacts (no chain, no apply). Returns the Artifacts path.
 */
export async function transformOneSource(
  sourceId: string,
  env: Record<string, string | undefined>,
  logger: { info: (message: string) => void } = SILENT,
): Promise<{ artifactsPath: string } | { error: CommandResult }> {
  const standalone = await loadSourceStandalone(sourceId, SOURCES_ROOT);
  const workspace = intakeWorkspace(env);
  const paths = standalone
    ? []
    : await sourceInputPaths(await sourceInputDir(workspace, sourceId));
  const deps = await buildRunSourceDeps(sourceId, paths, env, {
    commandArgs: ["data", "transform", sourceId, ...paths],
    logger,
  });
  return transformSource(sourceId, paths, { standalone }, deps);
}

/**
 * `data generate <ns>`: import the source's latest transform Artifacts against the
 * database at head (a dry import → DatabaseMutations delta) and append it as the next
 * chain entry. Returns the appended entry, or a zero-mutation result for an empty diff.
 */
export async function generateOneSource(
  sourceId: string,
  env: Record<string, string | undefined>,
): Promise<
  { version?: string; mutationCount: number } | { error: CommandResult }
> {
  const workspace = intakeWorkspace(env);
  const artifactsPath = await newestSourceOutput(
    workspace,
    sourceId,
    ".Artifacts.yaml",
  );
  if (artifactsPath === undefined) {
    return {
      error: {
        exitCode: 1,
        stderr: `No transform output for ${sourceId}; run \`intake data transform ${sourceId}\` first.\n`,
      },
    };
  }
  const importResult = await runImportArtifactsCommand(artifactsPath, {
    dryImport: true,
    env,
    terminal: false,
    args: ["data", "generate", sourceId],
  });
  if (importResult.exitCode !== 0) {
    return { error: importResult };
  }
  const mutationsPath = await newestSourceOutput(
    workspace,
    sourceId,
    ".DatabaseMutations.yaml",
  );
  if (mutationsPath === undefined) {
    return { mutationCount: 0 };
  }
  return generateEntry(mutationsPath);
}

/** True when `id` names a source folder under `sources/`. */
export async function isSourceId(id: string): Promise<boolean> {
  return stat(path.join(SOURCES_ROOT, id))
    .then((entry) => entry.isDirectory())
    .catch(() => false);
}

/**
 * Every source that produces something, in dependency order (ADR 0021) — the order
 * `rebuild` walks, transforming/generating/applying each so a producer is applied
 * before a consumer transforms against it.
 */
export async function orderedSourceIds(): Promise<string[]> {
  const ids = await matchSourceIds(SOURCES_ROOT, "*");
  const sources = await Promise.all(
    ids.map(async (id) => ({
      id,
      produces: await loadSourceProduces(id, SOURCES_ROOT),
    })),
  );
  return planSourceOrder(sources).order;
}
