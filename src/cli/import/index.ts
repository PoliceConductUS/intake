import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerDiscoveredCommands } from "../../shared/cli/command-discovery.js";
import type { CliCommandDependencies } from "../../shared/cli/types.js";

export async function registerCliCommand(
  program: Command,
  dependencies: CliCommandDependencies,
): Promise<void> {
  const importCommand = program
    .command("import")
    .description("Import source-produced intake artifacts.");

  await registerDiscoveredCommands(
    importCommand,
    path.dirname(fileURLToPath(import.meta.url)),
    dependencies,
  );
}
