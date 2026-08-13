import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { importArtifacts, type ImportArtifactsResult } from "./config.js";
import { formatDatabaseMutationCountLines } from "./io/DatabaseMutationCounts.js";
import { createIntakeLog } from "../../../logging.js";
import { createCommandDirectory } from "../../command-directory.js";
import type {
  CliCommandDependencies,
  CommandResult,
} from "../../../shared/cli/types.js";
import type { ExcludedRecords } from "../../../shared/io/excluded-records.js";

async function readableArtifactsFileResult(
  artifactsRef: string,
): Promise<CommandResult | undefined> {
  try {
    await access(artifactsRef, constants.R_OK);
    const artifactsStat = await stat(artifactsRef);

    if (!artifactsStat.isFile()) {
      return {
        exitCode: 1,
        stderr: `Artifacts is not a file: ${artifactsRef}\n`,
      };
    }

    return undefined;
  } catch {
    return {
      exitCode: 1,
      stderr: `Artifacts is not readable: ${artifactsRef}\n`,
    };
  }
}

export function registerCliCommand(
  importCommand: Command,
  dependencies: CliCommandDependencies,
): void {
  importCommand
    .command("artifacts")
    .description("Import a source-produced Artifacts file into DATABASE_URL.")
    .argument("<artifacts-ref>", "source-produced Artifacts file")
    .option(
      "--dry-run",
      "Write the DatabaseMutations envelope without applying database mutations",
    )
    .action(
      async (
        artifactsRef: string,
        options: { dryRun?: boolean },
      ): Promise<void> => {
        const fileResult = await readableArtifactsFileResult(artifactsRef);
        if (fileResult) {
          dependencies.setResult(fileResult);
          return;
        }

        const runImport =
          dependencies.runImportArtifactsCommand ?? runImportArtifactsCommand;
        dependencies.setResult(
          await runImport(artifactsRef, { dryImport: options.dryRun }),
        );
      },
    );
}

export async function runImportArtifactsCommand(
  artifactsRef: string,
  dependencies: {
    importArtifacts?: (input: {
      artifactsPath: string;
      logger?: ReturnType<typeof createIntakeLog>["logger"];
      dryImport?: boolean;
      env?: Record<string, string | undefined>;
      commandDirectory?: string;
      commandName?: string;
      excludedRecords?: ExcludedRecords;
    }) => Promise<ImportArtifactsResult>;
    env?: Record<string, string | undefined>;
    terminal?: { write(text: string): unknown } | false;
    dryImport?: boolean;
    excludedRecords?: ExcludedRecords;
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
      args: dependencies.args ?? [
        "import",
        "artifacts",
        ...(dependencies.dryImport === true ? ["--dry-run"] : []),
        artifactsRef,
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
  logger.info(`Importing artifacts: ${artifactsRef}`);
  if (dependencies.dryImport === true) {
    logger.info(
      "Dry run: DatabaseMutations envelope will be created without database create/read/update.",
    );
  }
  logger.info({ artifactsPath: artifactsRef }, "Artifacts import started.");

  const result = await (dependencies.importArtifacts ?? importArtifacts)({
    artifactsPath: artifactsRef,
    logger,
    dryImport: dependencies.dryImport,
    env,
    commandDirectory: command.commandDirectory,
    commandName: command.commandName,
    excludedRecords: dependencies.excludedRecords,
  });

  if (!result.ok) {
    logger.error(
      { artifactsPath: artifactsRef, error: result.error },
      "Artifacts import failed.",
    );
    return {
      exitCode: 1,
      stderr: `${result.error}\n`,
    };
  }

  logger.info(
    {
      artifactsPath: artifactsRef,
      databaseMutations: result.counts.mutations,
      recordsByEntityType: result.counts.recordsByEntityType,
    },
    "Artifacts import succeeded.",
  );

  return {
    exitCode: 0,
    stdout: [
      dependencies.dryImport === true
        ? "Created DatabaseMutations envelope. Database apply skipped."
        : "Imported artifact database records.",
      ...formatDatabaseMutationCountLines(result.counts),
      "",
    ].join("\n"),
  };
}
