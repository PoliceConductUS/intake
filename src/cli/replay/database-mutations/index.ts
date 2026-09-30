import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  replayDatabaseMutations,
  type ReplayDatabaseMutationsResult,
} from "./config.js";
import { formatDatabaseMutationCountLines } from "../../import/artifacts/io/DatabaseMutationCounts.js";
import { createIntakeLog } from "../../../logging.js";
import { createCommandDirectory } from "../../command-directory.js";
import { DatabaseMutations } from "../../import/artifacts/io/DatabaseMutations.js";
import type {
  CliCommandDependencies,
  CommandResult,
} from "../../../shared/cli/types.js";

async function databaseMutationsNamespace(
  databaseMutationsRef: string,
): Promise<string | undefined> {
  try {
    return (await DatabaseMutations.read(databaseMutationsRef, { raw: true }))
      .metadata.namespace;
  } catch {
    return undefined;
  }
}

async function readableDatabaseMutationsFileResult(
  databaseMutationsRef: string,
): Promise<CommandResult | undefined> {
  try {
    await access(databaseMutationsRef, constants.R_OK);
    const databaseMutationsStat = await stat(databaseMutationsRef);

    if (!databaseMutationsStat.isFile()) {
      return {
        exitCode: 1,
        stderr: `DatabaseMutations is not a file: ${databaseMutationsRef}\n`,
      };
    }

    return undefined;
  } catch {
    return {
      exitCode: 1,
      stderr: `DatabaseMutations is not readable: ${databaseMutationsRef}\n`,
    };
  }
}

export function registerCliCommand(
  replayCommand: Command,
  dependencies: CliCommandDependencies,
): void {
  replayCommand
    .command("database-mutations")
    .description(
      "Re-run an existing DatabaseMutations file against DATABASE_URL.",
    )
    .argument("<database-mutations-ref>", "DatabaseMutations file")
    .action(async (databaseMutationsRef: string): Promise<void> => {
      const fileResult =
        await readableDatabaseMutationsFileResult(databaseMutationsRef);
      if (fileResult) {
        dependencies.setResult(fileResult);
        return;
      }

      const replayImport =
        dependencies.runReplayDatabaseMutationsCommand ??
        runReplayDatabaseMutationsCommand;
      dependencies.setResult(await replayImport(databaseMutationsRef));
    });
}

export async function runReplayDatabaseMutationsCommand(
  databaseMutationsRef: string,
  dependencies: {
    replayDatabaseMutations?: (input: {
      databaseMutationsPath: string;
      env?: Record<string, string | undefined>;
    }) => Promise<ReplayDatabaseMutationsResult>;
    env?: Record<string, string | undefined>;
    terminal?: { write(text: string): unknown } | false;
    args?: readonly string[];
    now?: Date;
    createCommandName?: () => string;
  } = {},
): Promise<CommandResult> {
  const env = dependencies.env ?? process.env;
  let command;
  try {
    command = await createCommandDirectory(env, {
      now: dependencies.now,
      createCommandName: dependencies.createCommandName,
      namespace: await databaseMutationsNamespace(databaseMutationsRef),
      args: dependencies.args ?? [
        "replay",
        "database-mutations",
        databaseMutationsRef,
      ],
    });
  } catch (error) {
    return {
      exitCode: 1,
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
  const { logger, logPath } = createIntakeLog({
    logPath: path.join(command.commandDirectory, `${command.commandName}.log`),
    level: env.LOG_LEVEL,
    terminal: dependencies.terminal,
  });
  logger.info(`Writing logs to ${logPath}`);
  logger.info(`Log level: ${env.LOG_LEVEL ?? "info"}`);
  logger.info(`Replaying DatabaseMutations: ${databaseMutationsRef}`);
  logger.info(
    { databaseMutationsPath: databaseMutationsRef },
    "DatabaseMutations replay started.",
  );

  const result = await (
    dependencies.replayDatabaseMutations ?? replayDatabaseMutations
  )({ databaseMutationsPath: databaseMutationsRef, env });

  if (!result.ok) {
    logger.error(
      { databaseMutationsPath: databaseMutationsRef, error: result.error },
      "DatabaseMutations replay failed.",
    );
    return {
      exitCode: 1,
      stderr: `${result.error}\n`,
    };
  }

  logger.info(
    {
      databaseMutationsPath: databaseMutationsRef,
      databaseMutations: result.counts.mutations,
      recordsByEntityType: result.counts.recordsByEntityType,
    },
    "DatabaseMutations replay succeeded.",
  );

  return {
    exitCode: 0,
    stdout: [
      "Replayed DatabaseMutations.",
      ...formatDatabaseMutationCountLines(result.counts),
      "",
    ].join("\n"),
  };
}
