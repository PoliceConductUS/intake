#!/usr/bin/env node

import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Command } from "commander";

export type CommandResult = {
  exitCode: number;
  stdout?: string;
  stderr?: string;
};

const rootHelp = `Usage: intake <command>

Intake validates and files deterministic intake packages.

Commands:
  validate <manifest-ref>  Check whether a local manifest can be read

Run "intake validate --help" for details.
`;

const validateHelp = `Usage: intake validate <manifest-ref>

Check whether a local manifest can be read.

This is an initial CLI scaffold. It requires a readable local file, then fails
until IntakePackage validation is implemented.
`;

function isHelpRequest(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

async function readableManifestFileResult(
  manifestRef: string,
): Promise<CommandResult | undefined> {
  try {
    await access(manifestRef, constants.R_OK);
    const manifestStat = await stat(manifestRef);

    if (!manifestStat.isFile()) {
      return {
        exitCode: 1,
        stderr: `Manifest is not a file: ${manifestRef}\n`,
      };
    }

    return undefined;
  } catch {
    return {
      exitCode: 1,
      stderr: `Manifest is not readable: ${manifestRef}\n`,
    };
  }
}

export async function runValidateCommand(
  manifestRef: string | undefined,
): Promise<CommandResult> {
  if (!manifestRef) {
    return {
      exitCode: 1,
      stderr: `Missing required manifest ref.\n\n${validateHelp}`,
    };
  }

  const fileResult = await readableManifestFileResult(manifestRef);
  if (fileResult) {
    return fileResult;
  }

  return {
    exitCode: 1,
    stderr: "IntakePackage validation is not implemented yet.\n",
  };
}

export async function runIntake(
  args: readonly string[],
): Promise<CommandResult> {
  if (args.length === 0 || isHelpRequest(args.slice(0, 1))) {
    return { exitCode: 0, stdout: rootHelp };
  }

  if (args[0] === "validate" && isHelpRequest(args.slice(1))) {
    return { exitCode: 0, stdout: validateHelp };
  }

  let commandResult: CommandResult | undefined;
  const program = new Command();
  program
    .name("intake")
    .exitOverride()
    .allowUnknownOption(false)
    .helpOption(false)
    .showHelpAfterError(false)
    .showSuggestionAfterError(false);

  program
    .command("validate")
    .helpOption(false)
    .argument("[manifestRef]")
    .argument("[extra...]")
    .action(async (manifestRef: string | undefined, extra: string[]) => {
      commandResult =
        extra.length > 0
          ? {
              exitCode: 1,
              stderr: `Validate accepts exactly one manifest ref.\n\n${validateHelp}`,
            }
          : await runValidateCommand(manifestRef);
    });

  try {
    await program.parseAsync([...args], { from: "user" });
  } catch (error) {
    const commanderError = error as Error & { code?: string; message?: string };
    if (commanderError.code === "commander.unknownCommand") {
      return {
        exitCode: 1,
        stderr: `Unknown command: ${args[0]}\n\n${rootHelp}`,
      };
    }

    return {
      exitCode: 1,
      stderr: `${commanderError.message ?? "Command failed"}\n`,
    };
  }

  return commandResult ?? { exitCode: 1, stderr: rootHelp };
}

async function main(): Promise<void> {
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
