import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerDiscoveredCommands } from "../../shared/cli/command-discovery.js";
import type { CliCommandDependencies } from "../../shared/cli/types.js";

export async function registerCliCommand(
  program: Command,
  dependencies: CliCommandDependencies,
): Promise<void> {
  const replayCommand = program
    .command("replay")
    .description("Replay prepared intake execution envelopes.");

  await registerDiscoveredCommands(
    replayCommand,
    path.dirname(fileURLToPath(import.meta.url)),
    dependencies,
  );
}
