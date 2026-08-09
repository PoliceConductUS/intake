import { createHash } from "node:crypto";
import path from "node:path";
import { Command } from "commander";
import { Artifacts } from "../../shared/io/index.js";
import { createCommandDirectory } from "../command-directory.js";
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

type RunSourceDeps = {
  sourcesRoot: string;
  env: Record<string, string | undefined>;
  loadSourceModule: typeof loadSourceModule;
  readXlsx: typeof readXlsx;
  makeWorkspace: (env: Record<string, string | undefined>) => Promise<string>;
  writeEnvelope: (
    directory: string,
    sourceId: string,
    digest: string,
    manifest: SourceManifest,
  ) => Promise<{ path: string }>;
  runImport: (
    ref: string,
    opts: { dryImport?: boolean },
  ) => Promise<CommandResult>;
};

/**
 * Derives a deterministic run-scoped digest from the input paths. It hashes
 * the path strings themselves (not file bytes): no clock, no randomness, and
 * no filesystem access, so a source id + a set of paths always produces the
 * same envelope name without requiring the paths to already exist on disk.
 */
function digestOfPaths(paths: readonly string[]): string {
  const hash = createHash("sha256");
  for (const p of paths) hash.update(p);
  return hash.digest("hex").slice(0, 16);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    const manifest = await run({ paths, readXlsx: deps.readXlsx });
    const digest = digestOfPaths(paths);
    const workspace = await deps.makeWorkspace(deps.env);
    const { path: artifactsPath } = await deps.writeEnvelope(
      workspace,
      sourceId,
      digest,
      manifest,
    );
    return await deps.runImport(artifactsPath, { dryImport: options.dryRun });
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
    .description("Run a source's config.ts and import the records it returns.")
    .argument("<source-id>", "source id under sources/")
    .argument("<paths...>", "one or more snapshot files or folders")
    .option(
      "--dry-run",
      "Write the DatabaseMutations envelope without applying it",
    )
    .action(
      async (
        sourceId: string,
        paths: string[],
        options: { dryRun?: boolean },
      ): Promise<void> => {
        const env = process.env;
        const deps: RunSourceDeps = {
          sourcesRoot: path.join(process.cwd(), "sources"),
          env,
          loadSourceModule,
          readXlsx,
          makeWorkspace: async (e) =>
            (
              await createCommandDirectory(e, {
                namespace: sourceId,
                args: ["run", sourceId, ...paths],
              })
            ).commandDirectory,
          writeEnvelope: async (directory, id, digest, manifest) =>
            Artifacts.write(directory, buildArtifactsEnvelope(id, digest, manifest)),
          runImport:
            dependencies.runImportArtifactsCommand ?? runImportArtifactsCommand,
        };
        dependencies.setResult(await runSource(sourceId, paths, options, deps));
      },
    );
};
