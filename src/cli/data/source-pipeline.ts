import path from "node:path";
import { importTypeMetadata } from "../../shared/io/import-type-metadata.js";
import {
  requireTransformCompletion,
  beginTransform,
} from "../state/transform-completion.js";
import type { CommandResult } from "../../shared/cli/types.js";
import { intakeWorkspace } from "../command-directory.js";
import {
  buildTransformSourceDeps,
  sourceInputDir,
  sourceInputPaths,
  transformSource,
} from "../transform/index.js";
import {
  assertValidSourceId,
  loadSourceProduces,
  loadSourceStandalone,
} from "../transform/load-source-module.js";
import { planSourceOrder } from "../transform/source-order.js";
import { matchSourceIds } from "../source-glob.js";
import { runImportArtifactsCommand } from "../import/artifacts/index.js";
import { generateEntry } from "./chain.js";
import type { ImportArtifactKind } from "../../shared/io/index.js";

const SOURCES_ROOT = path.join(process.cwd(), "sources");
const SILENT = { info: () => {} };

/**
 * `data transform <source>`: run a source's transform.ts against its latest acquired input to
 * produce and write its Artifacts (no chain, no apply). Returns the Artifacts path.
 */
export async function transformOneSource(
  sourceId: string,
  env: Record<string, string | undefined>,
  logger: { info: (message: string) => void } = SILENT,
  kinds?: readonly ImportArtifactKind[],
): Promise<{ artifactsPath: string } | { error: CommandResult }> {
  assertValidSourceId(sourceId);
  await beginTransform(path.join(intakeWorkspace(env), "state", sourceId));
  const standalone = await loadSourceStandalone(sourceId, SOURCES_ROOT);
  const workspace = intakeWorkspace(env);
  const paths = standalone
    ? []
    : await sourceInputPaths(await sourceInputDir(workspace, sourceId));
  const deps = await buildTransformSourceDeps(sourceId, paths, env, {
    commandArgs: ["data", "transform", sourceId, ...paths],
    logger,
  });
  if (kinds !== undefined) {
    const recordKinds = new Set<string>(
      kinds.map((kind) => importTypeMetadata[kind].recordKind),
    );
    const loadExclusions = deps.loadExcludedRecords;
    deps.loadExcludedRecords = async (state) =>
      new Map(
        [...(await loadExclusions(state))].filter(([, record]) =>
          recordKinds.has(record.kind),
        ),
      );
    const load = deps.loadSourceModule;
    deps.loadSourceModule = async (...args) => {
      const transform = await load(...args);
      return async (input) => {
        const manifest = await transform(input);
        return {
          ...manifest,
          artifacts: manifest.artifacts.filter((artifact) =>
            kinds.includes(artifact.kind),
          ),
        };
      };
    };
  }
  return transformSource(sourceId, paths, { standalone }, deps);
}

/**
 * `data generate <source>`: import the source's latest transform Artifacts against the
 * database at head (a dry import → DatabaseMutations delta) and append it as the next
 * chain entry. Returns the appended entry, or a zero-mutation result for an empty diff.
 */
export async function generateOneSource(
  sourceId: string,
  env: Record<string, string | undefined>,
  useInitialAgencyRoots?: boolean,
): Promise<
  { version?: string; mutationCount: number } | { error: CommandResult }
> {
  const workspace = intakeWorkspace(env);
  let artifactsPath: string;
  try {
    artifactsPath = await requireTransformCompletion(workspace, sourceId);
  } catch (error) {
    return {
      error: {
        exitCode: 1,
        stderr: `${error instanceof Error ? error.message : String(error)}\n`,
      },
    };
  }
  const importResult = await runImportArtifactsCommand(artifactsPath, {
    dryImport: true,
    useInitialAgencyRoots,
    env,
    terminal: false,
    args: ["data", "generate", sourceId],
  });
  if (importResult.exitCode !== 0) {
    return { error: importResult };
  }
  if (importResult.databaseMutationsPath === undefined) {
    return {
      error: {
        exitCode: 1,
        stderr: "Import completed without its DatabaseMutations output.\n",
      },
    };
  }
  return generateEntry(importResult.databaseMutationsPath);
}

/**
 * Every automatic source that produces something, in dependency order (ADR 0021) — the order
 * `update` walks, transforming/generating/applying each so a producer is applied
 * before a consumer transforms against it.
 */
export async function orderedSourceIds(): Promise<string[]> {
  const ids = await matchSourceIds(SOURCES_ROOT, "*");
  const sources = await Promise.all(
    ids.map(async (id) => ({
      id,
      produces: await loadSourceProduces(id, SOURCES_ROOT),
      standalone: await loadSourceStandalone(id, SOURCES_ROOT),
    })),
  );
  return planSourceOrder(sources.filter((source) => !source.standalone)).order;
}
