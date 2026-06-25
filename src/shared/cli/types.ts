import type { Command } from "commander";

export type CommandResult = {
  exitCode: number;
  stdout?: string;
  stderr?: string;
};

export type CliCommandDependencies = {
  runImportArtifactsCommand?: (
    artifactsRef: string,
    dependencies?: { dryImport?: boolean },
  ) => Promise<CommandResult>;
  runReplayDatabaseMutationsCommand?: (
    databaseMutationsRef: string,
  ) => Promise<CommandResult>;
  setResult(result: CommandResult): void;
};

export type RegisterCliCommand = (
  command: Command,
  dependencies: CliCommandDependencies,
) => void | Promise<void>;
