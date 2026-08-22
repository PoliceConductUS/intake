import { cp, access } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  createCommandDirectory,
  intakeWorkspace,
} from "../command-directory.js";
import type {
  CliCommandDependencies,
  CommandResult,
  RegisterCliCommand,
} from "../../shared/cli/types.js";
import type {
  AcquireDataContext,
  AcquireDeps,
  SourceAcquire,
} from "../run/source-run.js";
import { defaultDatabaseClientFactory } from "../database/index.js";
import { createAcquireDataContext } from "./acquire-data-context.js";
import { loadSourceAcquire } from "../run/load-source-module.js";
import { sourceStateDir } from "../run/state.js";
import { matchSourceIds } from "../source-glob.js";
import {
  readCommandPointer,
  writeCommandPointer,
} from "../state/command-pointer.js";

type AcquireSourceDeps = {
  sourcesRoot: string;
  env: Record<string, string | undefined>;
  workspace: string;
  state: string;
  loadSourceAcquire: typeof loadSourceAcquire;
  createCommandDirectory: typeof createCommandDirectory;
  data: AcquireDataContext;
  logger: { info: (message: string) => void };
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
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
    const pointer = await readCommandPointer(deps.state, "acquire");
    const { outputDirectory: outputDir } = await deps.createCommandDirectory(
      deps.env,
      { namespace: sourceId, args: ["acquire", sourceId] },
    );

    if (pointer.resume) {
      const resumeDir = path.join(deps.workspace, pointer.resume);
      if (await pathExists(resumeDir)) {
        deps.logger.info(
          `${sourceId}: resuming the previous acquire from ${pointer.resume}. ` +
            `To start fresh instead, delete that folder (or the "resume" key in ` +
            `${path.join(deps.state, "acquire.yaml")}) and re-run.`,
        );
        await cp(resumeDir, outputDir, { recursive: true });
      }
    }

    const outputRelative = path.relative(deps.workspace, outputDir);
    await writeCommandPointer(deps.state, "acquire", {
      ...pointer,
      resume: outputRelative,
    });

    const acquireDeps: AcquireDeps = {
      sourceDir: outputDir,
      state: deps.state,
      env: deps.env,
      data: deps.data,
      logger: deps.logger,
    };
    await acquire(acquireDeps);

    await writeCommandPointer(deps.state, "acquire", {
      latest: outputRelative,
    });
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
        "<glob>, writing raw inputs (html/csv/json, no transforms) into a fresh " +
        "command's <source>/output/ for a later `intake run`. " +
        "Only sources that export an acquire function are supported.",
    )
    .argument(
      "[glob]",
      "glob matching source folder name(s) under sources/ — quote it, e.g. 'mn-post'; defaults to all sources",
      "*",
    )
    .addHelpText(
      "after",
      "\nRun `intake sources` to list which sources support acquire.",
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

        const logger = {
          info: (message: string) => process.stderr.write(`${message}\n`),
        };
        const databaseUrl = env.DATABASE_URL;
        const client =
          databaseUrl !== undefined && databaseUrl.trim().length > 0
            ? defaultDatabaseClientFactory(databaseUrl)
            : undefined;
        if (client !== undefined) await client.connect();
        const data: AcquireDataContext =
          client !== undefined
            ? createAcquireDataContext(client)
            : {
                agencies: () => {
                  throw new Error(
                    "DATABASE_URL is required for acquire data access (agencies).",
                  );
                },
              };
        try {
          for (const sourceId of sourceIds) {
            const result = await acquireSource(sourceId, {
              sourcesRoot,
              env,
              workspace,
              state: await sourceStateDir(env, sourceId),
              loadSourceAcquire,
              createCommandDirectory,
              data,
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
        } finally {
          if (client !== undefined) await client.end();
        }
      } catch (error) {
        dependencies.setResult({
          exitCode: 1,
          stderr: `${errorMessage(error)}\n`,
        });
      }
    });
};
