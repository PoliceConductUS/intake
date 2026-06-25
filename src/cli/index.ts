#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";
import { registerDiscoveredCommands } from "../shared/cli/command-discovery.js";
import type { CommandResult } from "../shared/cli/types.js";

export { runImportArtifactsCommand } from "./import/artifacts/index.js";
export { runReplayDatabaseMutationsCommand } from "./replay/database-mutations/index.js";
export type { CommandResult } from "../shared/cli/types.js";

export function loadCliEnvironment(): void {
  try {
    process.loadEnvFile();
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }
}

export type IntakeCliDependencies = {
  runImportArtifactsCommand?: (
    artifactsRef: string,
    dependencies?: { dryImport?: boolean },
  ) => Promise<CommandResult>;
  runReplayDatabaseMutationsCommand?: (
    databaseMutationsRef: string,
  ) => Promise<CommandResult>;
};

async function createProgram(
  dependencies: IntakeCliDependencies,
  output: { stdout: string; stderr: string },
  setResult: (result: CommandResult) => void,
): Promise<Command> {
  const program = new Command();
  program
    .name("intake")
    .usage("<command>")
    .description("Intake validates and files deterministic intake artifacts.")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        output.stdout += text;
      },
      writeErr: (text) => {
        output.stderr += text;
      },
    });

  await registerDiscoveredCommands(
    program,
    path.dirname(fileURLToPath(import.meta.url)),
    { ...dependencies, setResult },
  );

  return program;
}

export async function runIntake(
  args: readonly string[],
  dependencies: IntakeCliDependencies = {},
): Promise<CommandResult> {
  let actionResult: CommandResult | undefined;
  const output = { stdout: "", stderr: "" };
  const program = await createProgram(dependencies, output, (result) => {
    actionResult = result;
  });

  try {
    await program.parseAsync([...args], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return {
        exitCode: error.exitCode,
        stdout: output.stdout || undefined,
        stderr: output.stderr || undefined,
      };
    }
    throw error;
  }

  return (
    actionResult ?? {
      exitCode: 0,
      stdout: output.stdout || undefined,
      stderr: output.stderr || undefined,
    }
  );
}

async function main(): Promise<void> {
  loadCliEnvironment();

  const result = await runIntake(process.argv.slice(2));

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  process.exitCode = result.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
