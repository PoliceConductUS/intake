import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { intakeWorkspace } from "../command-directory.js";
import type {
  CliCommandDependencies,
  CommandResult,
  RegisterCliCommand,
} from "../../shared/cli/types.js";
import type { AcquireDeps, SourceAcquire } from "../run/source-run.js";
import { loadSourceAcquire } from "../run/load-source-module.js";
import { sourceStateDir } from "../run/state.js";
import { matchSourceIds } from "../source-glob.js";

type AcquireSourceDeps = {
  sourcesRoot: string;
  env: Record<string, string | undefined>;
  loadSourceAcquire: typeof loadSourceAcquire;
  sourceDir: string;
  state: string;
  logger: { info: (message: string) => void };
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function acquireSource(
  sourceId: string,
  deps: AcquireSourceDeps,
): Promise<CommandResult> {
  let acquire: SourceAcquire;
  try {
    acquire = await deps.loadSourceAcquire(sourceId, deps.sourcesRoot);
  } catch (error) {
    return { exitCode: 1, stderr: `${errorMessage(error)}\n` };
  }

  try {
    await mkdir(deps.sourceDir, { recursive: true });
    const acquireDeps: AcquireDeps = {
      sourceDir: deps.sourceDir,
      state: deps.state,
      env: deps.env,
      logger: deps.logger,
    };
    await acquire(acquireDeps);
    return { exitCode: 0 };
  } catch (error) {
    return { exitCode: 1, stderr: `${errorMessage(error)}\n` };
  }
}

export const registerCliCommand: RegisterCliCommand = (
  program: Command,
  dependencies: CliCommandDependencies,
): void => {
  program
    .command("acquire")
    .description(
      "Run the acquire (download/scrape) phase of every source folder matching " +
        "<glob>, writing raw inputs (html/csv/json, no transforms) into " +
        "$INTAKE_WORKSPACE/<source-id>/source/ for a later `intake run`. " +
        "Only sources that export an acquire function are supported.",
    )
    .argument(
      "<glob>",
      "glob matching source folder name(s) under sources/ — quote it, e.g. '*' or 'mn-post'",
    )
    .action(async (glob: string): Promise<void> => {
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

        // Acquire is long-running, so progress streams live to stderr rather
        // than buffering into the command result.
        const logger = {
          info: (message: string) => process.stderr.write(`${message}\n`),
        };
        for (const sourceId of sourceIds) {
          const result = await acquireSource(sourceId, {
            sourcesRoot,
            env,
            loadSourceAcquire,
            sourceDir: path.join(workspace, sourceId, "source"),
            state: await sourceStateDir(env, sourceId),
            logger,
          });
          if (result.exitCode !== 0) {
            dependencies.setResult({
              exitCode: result.exitCode,
              stderr: `${result.stderr ?? ""}intake acquire failed on source ${sourceId}\n`,
            });
            return;
          }
        }
        dependencies.setResult({ exitCode: 0 });
      } catch (error) {
        dependencies.setResult({
          exitCode: 1,
          stderr: `${errorMessage(error)}\n`,
        });
      }
    });
};
