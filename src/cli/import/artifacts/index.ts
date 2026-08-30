import path from "node:path";
import { importArtifacts, type ImportArtifactsResult } from "./config.js";
import { formatDatabaseMutationCountLines } from "./io/DatabaseMutationCounts.js";
import { createIntakeLog } from "../../../logging.js";
import {
  createCommandDirectory,
  intakeWorkspace,
} from "../../command-directory.js";
import { writeCommandPointer } from "../../state/command-pointer.js";
import { Artifacts } from "../../../shared/io/index.js";
import type { CommandResult } from "../../../shared/cli/types.js";
import type { ExcludedRecords } from "../../../shared/io/excluded-records.js";

async function artifactsNamespace(
  artifactsRef: string,
): Promise<string | undefined> {
  try {
    return (await Artifacts.read(artifactsRef, { raw: true })).metadata
      .namespace;
  } catch {
    return undefined;
  }
}

// The import phase is not its own CLI command: `data generate` calls this
// directly (dry) to diff a source's Artifacts into a DatabaseMutations delta.
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
  const namespace = await artifactsNamespace(artifactsRef);
  let command;
  try {
    command = await createCommandDirectory(env, {
      now: dependencies.now,
      createCommandName: dependencies.createCommandName,
      namespace,
      // The import is not its own command (ADR 0035): `data generate` calls this
      // and passes explicit args. This default names that caller for the audit
      // trail when a programmatic caller omits them.
      args: dependencies.args ?? ["data", "generate", artifactsRef],
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
    commandDirectory: command.outputDirectory,
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

  if (namespace !== undefined && dependencies.dryImport !== true) {
    const workspace = intakeWorkspace(env);
    await writeCommandPointer(
      path.join(workspace, "state", namespace),
      "import",
      {
        latest: path.relative(workspace, command.outputDirectory),
      },
    );
  }

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
