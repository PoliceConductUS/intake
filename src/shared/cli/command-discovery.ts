import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Command } from "commander";
import type { CliCommandDependencies, RegisterCliCommand } from "./types.js";

export async function registerDiscoveredCommands(
  parentCommand: Command,
  directory: string,
  dependencies: CliCommandDependencies,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const modulePath = path.join(directory, entry.name, "index.js");
    const sourceModulePath = path.join(directory, entry.name, "index.ts");
    const moduleStat = await stat(modulePath).catch(() => undefined);
    const sourceModuleStat = await stat(sourceModulePath).catch(
      () => undefined,
    );
    if (moduleStat?.isFile() !== true && sourceModuleStat?.isFile() !== true) {
      continue;
    }
    const module = (await import(pathToFileURL(modulePath).href)) as {
      registerCliCommand?: RegisterCliCommand;
    };
    if (typeof module.registerCliCommand === "function") {
      await module.registerCliCommand(parentCommand, dependencies);
    }
  }
}
