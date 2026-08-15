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
import { createEmitSink } from "./emit-sink.js";
import type { EmitRefItem, EmitSink } from "./emit-sink.js";

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

const CENSUS_SOURCE_ID = "us-census-gazetteer";

/** Translates a shell-style glob (`*`, `?`) into an anchored RegExp. */
function globToRegExp(glob: string): RegExp {
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
async function matchSourceIds(
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

/** All non-hidden files under `<workspace>/<sourceId>/source/`, recursively. */
async function sourceInputPaths(
  workspace: string,
  sourceId: string,
): Promise<string[]> {
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
  return (await collect(path.join(workspace, sourceId, "source"))).sort();
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
    const excludedRecords = await deps.loadExcludedRecords(
      path.join(deps.sourcesRoot, sourceId),
    );
    const workspace = await deps.makeWorkspace(deps.env);
    const sink = deps.createEmitSink(workspace, sourceId);
    const manifest = await run({
      paths,
      readXlsx: deps.readXlsx,
      state: deps.state,
      emit: sink.emit,
    });
    const digest = await deps.digest(paths);
    const refItems = await sink.flush();
    const { path: artifactsPath } = await deps.writeEnvelope(
      workspace,
      sourceId,
      digest,
      manifest,
      refItems,
    );
    return await deps.runImport(artifactsPath, {
      dryImport: options.dryRun,
      excludedRecords,
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
      "Run the config.ts of every source folder matching <glob> and import the " +
        "records it returns. Inputs are read from $INTAKE_WORKSPACE/<source-id>/source/. " +
        "When us-census-gazetteer matches it runs first (ADR 0015); the rest run in name order.",
    )
    .argument(
      "<glob>",
      "glob matching source folder name(s) under sources/ — quote it, e.g. '*' or 'gov.*'",
    )
    .option(
      "--dry-run",
      "Write each DatabaseMutations envelope without applying it",
    )
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

          const stdout: string[] = [];
          for (const sourceId of sourceIds) {
            const paths = await sourceInputPaths(workspace, sourceId);
            if (paths.length === 0) {
              dependencies.setResult({
                exitCode: 1,
                stdout: stdout.join(""),
                stderr: `No input files for ${sourceId} at ${path.join(workspace, sourceId, "source")}\n`,
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
                ).commandDirectory,
              createEmitSink,
              loadExcludedRecords,
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
            };
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
