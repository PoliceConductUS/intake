#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { runIntake } from "./run-intake.js";

export { runIntake, type IntakeCliDependencies } from "./run-intake.js";
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
