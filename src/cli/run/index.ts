import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { Artifacts, loadExcludedRecords } from "../../shared/io/index.js";
import type { ExcludedRecords } from "../../shared/io/index.js";
import {
  createCommandDirectory,
  intakeWorkspace,
} from "../command-directory.js";
import { runImportArtifactsCommand } from "../import/artifacts/index.js";
import type {
  CliCommandDependencies,
  CommandResult,
  RegisterCliCommand,
} from "../../shared/cli/types.js";
import { buildArtifactsEnvelope } from "./source-run.js";
import type { SourceManifest } from "./source-run.js";
import { loadSourceModule } from "./load-source-module.js";
import { readXlsx } from "./read-xlsx.js";
import { sourceStateDir } from "./state.js";
import { seedResolvedPropertyCache } from "../state/resolved-property/index.js";
import { excludeManifestRecords } from "./exclude-records.js";
import { createEmitSink } from "./emit-sink.js";
import type { EmitRefItem, EmitSink } from "./emit-sink.js";
import { matchSourceIds } from "../source-glob.js";
import { readCommandPointer } from "../state/command-pointer.js";

type RunSourceDeps = {
  sourcesRoot: string;
  env: Record<string, string | undefined>;
  loadSourceModule: typeof loadSourceModule;
  readXlsx: typeof readXlsx;
  state: string;
  digest: (paths: string[]) => Promise<string>;
  makeWorkspace: (env: Record<string, string | undefined>) => Promise<string>;
  createEmitSink: (workspaceDir: string, namespace: string) => EmitSink;
  loadExcludedRecords: (sourceDir: string) => Promise<ExcludedRecords>;
  seedResolvedPropertyCache: (
    seedDir: string,
    rootDir: string,
  ) => Promise<{ seeded: string[]; skipped: string[] }>;
  writeEnvelope: (
    directory: string,
    sourceId: string,
    digest: string,
    manifest: SourceManifest,
    refItems: EmitRefItem[],
  ) => Promise<{ path: string }>;
  runImport: (
    ref: string,
    opts: { dryImport?: boolean; excludedRecords?: ExcludedRecords },
  ) => Promise<CommandResult>;
  logger?: { info: (message: string) => void };
};

/**
 * Derives a deterministic, content-based digest from the input paths. Each
 * path's file bytes are hashed independently, the resulting per-file hashes
 * are sorted, and the sorted hashes are concatenated and hashed again. This
 * makes the digest depend only on the *set* of file contents involved: it is
 * independent of path names and of the order the paths were given, so an
 * updated snapshot at the same path yields a different digest, and identical
 * content at a different path yields the same digest.
 */
async function digestOfPaths(paths: readonly string[]): Promise<string> {
  const fileHashes = await Promise.all(
    paths.map(async (p) => {
      const bytes = await readFile(p);
      return createHash("sha256").update(bytes).digest("hex");
    }),
  );
  fileHashes.sort();
  const combined = createHash("sha256");
  for (const fileHash of fileHashes) combined.update(fileHash);
  return combined.digest("hex").slice(0, 16);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sourceInputDir(
  workspace: string,
  sourceId: string,
): Promise<string> {
  const { latest } = await readCommandPointer(
    path.join(workspace, "state", sourceId),
    "acquire",
  );
  return latest === undefined
    ? path.join(workspace, sourceId, "source")
    : path.join(workspace, latest);
}

async function sourceInputPaths(inputDir: string): Promise<string[]> {
  const collect = async (dir: string): Promise<string[]> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...(await collect(full)));
      else if (entry.isFile()) files.push(full);
    }
    return files;
  };
  return (await collect(inputDir)).sort();
}

export async function runSource(
  sourceId: string,
  paths: string[],
  options: { dryRun?: boolean },
  deps: RunSourceDeps,
): Promise<CommandResult> {
  if (paths.length === 0) {
    return { exitCode: 1, stderr: "intake run requires at least one path\n" };
  }

  let run;
  try {
    run = await deps.loadSourceModule(sourceId, deps.sourcesRoot);
  } catch (error) {
    return { exitCode: 1, stderr: `${errorMessage(error)}\n` };
  }

  try {
    const sourceDir = path.join(deps.sourcesRoot, sourceId);
    const excludedRecords = await deps.loadExcludedRecords(sourceDir);
    // Seed the durable ResolvedProperty cache from the source's committed
    // resolved-property-seed/ (manual resolutions the resolvers cannot derive)
    // before the import reads it — copy-if-absent, so anything already resolved
    // on disk wins (ADR 0018 point 8).
    const workspaceRoot =
      deps.env.INTAKE_WORKSPACE_TEST ?? deps.env.INTAKE_WORKSPACE;
    if (workspaceRoot !== undefined) {
      await deps.seedResolvedPropertyCache(
        path.join(sourceDir, "resolved-property-seed"),
        workspaceRoot,
      );
    }
    const workspace = await deps.makeWorkspace(deps.env);
    const sink = deps.createEmitSink(workspace, sourceId);
    const manifest = await run({
      paths,
      readXlsx: deps.readXlsx,
      state: deps.state,
      emit: sink.emit,
      env: deps.env,
      logger: deps.logger,
    });
    // Apply excluded.yaml at Artifacts generation (with FK cascade) so an
    // excluded record never enters the Artifacts — the import then sees a clean
    // envelope and needs no exclusion of its own.
    const { manifest: filteredManifest } = excludeManifestRecords(
      manifest,
      excludedRecords,
    );
    const digest = await deps.digest(paths);
    const refItems = await sink.flush();
    const { path: artifactsPath } = await deps.writeEnvelope(
      workspace,
      sourceId,
      digest,
      filteredManifest,
      refItems,
    );
    return await deps.runImport(artifactsPath, {
      dryImport: options.dryRun,
    });
  } catch (error) {
    return { exitCode: 1, stderr: `${errorMessage(error)}\n` };
  }
}

export const registerCliCommand: RegisterCliCommand = (
  program: Command,
  dependencies: CliCommandDependencies,
): void => {
  program
    .command("run")
    .description(
      "Run the run.ts (produce) phase of every source folder matching <glob> " +
        "and import the records it returns. Inputs come from the source's latest " +
        "successful acquire (via $INTAKE_WORKSPACE/state/<source-id>/acquire.yaml), " +
        "falling back to $INTAKE_WORKSPACE/<source-id>/source/. When " +
        "us-census-gazetteer matches it runs first (ADR 0015); the rest run in name order.",
    )
    .argument(
      "[glob]",
      "glob matching source folder name(s) under sources/ — quote it, e.g. 'gov.*'; defaults to all sources",
      "*",
    )
    .option(
      "--dry-run",
      "Write each DatabaseMutations envelope without applying it",
    )
    .addHelpText("after", "\nRun `intake sources` to list available sources.")
    .action(
      async (glob: string, options: { dryRun?: boolean }): Promise<void> => {
        const env = process.env;
        const sourcesRoot = path.join(process.cwd(), "sources");
        try {
          const workspace = intakeWorkspace(env);
          const sourceIds = await matchSourceIds(sourcesRoot, glob);
          if (sourceIds.length === 0) {
            dependencies.setResult({
              exitCode: 1,
              stderr: `No source folder under sources/ matches "${glob}".\n`,
            });
            return;
          }

          const logger = {
            info: (message: string) => process.stderr.write(`${message}\n`),
          };
          const stdout: string[] = [];
          for (const sourceId of sourceIds) {
            const inputDir = await sourceInputDir(workspace, sourceId);
            const paths = await sourceInputPaths(inputDir);
            if (paths.length === 0) {
              dependencies.setResult({
                exitCode: 1,
                stdout: stdout.join(""),
                stderr: `No input files for ${sourceId} at ${inputDir}\n`,
              });
              return;
            }
            const deps: RunSourceDeps = {
              sourcesRoot,
              env,
              loadSourceModule,
              readXlsx,
              state: await sourceStateDir(env, sourceId),
              digest: digestOfPaths,
              makeWorkspace: async (e) =>
                (
                  await createCommandDirectory(e, {
                    namespace: sourceId,
                    args: ["run", sourceId, ...paths],
                  })
                ).outputDirectory,
              createEmitSink,
              loadExcludedRecords,
              seedResolvedPropertyCache,
              writeEnvelope: async (
                directory,
                id,
                digest,
                manifest,
                refItems,
              ) =>
                Artifacts.write(
                  directory,
                  buildArtifactsEnvelope(id, digest, manifest, refItems),
                ),
              runImport:
                dependencies.runImportArtifactsCommand ??
                runImportArtifactsCommand,
              logger,
            };
            logger.info(`${sourceId}: run — ${paths.length} input file(s)`);
            const result = await runSource(sourceId, paths, options, deps);
            if (result.stdout) stdout.push(result.stdout);
            if (result.exitCode !== 0) {
              dependencies.setResult({
                exitCode: result.exitCode,
                stdout: stdout.join(""),
                stderr: `${result.stderr ?? ""}intake run failed on source ${sourceId}\n`,
              });
              return;
            }
          }
          dependencies.setResult({ exitCode: 0, stdout: stdout.join("") });
        } catch (error) {
          dependencies.setResult({
            exitCode: 1,
            stderr: `${errorMessage(error)}\n`,
          });
        }
      },
    );
};
