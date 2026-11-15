import path from "node:path";
import { loadIntakeSource } from "../source-discovery.js";
import { Command } from "commander";
import type {
  CliCommandDependencies,
  RegisterCliCommand,
} from "../../shared/cli/types.js";
import { describeSources, renderSourceCatalog } from "../describe-sources.js";

export const registerCliCommand: RegisterCliCommand = (
  program: Command,
  dependencies: CliCommandDependencies,
): void => {
  const sources = program
    .command("sources")
    .description("List sources, their descriptions, and supported operations.")
    .action(async (): Promise<void> => {
      const sourcesRoot = path.join(process.cwd(), "sources");
      const catalog = await describeSources(sourcesRoot);
      dependencies.setResult({
        exitCode: 0,
        stdout: renderSourceCatalog(catalog),
      });
    });
  sources
    .command("daily <source>")
    .description("Run a source's daily operation.")
    .action(async (id: string) => {
      const { daily } = await loadIntakeSource(
        id,
        path.join(process.cwd(), "sources"),
      );
      if (!daily) throw Error(`Source ${id} does not support daily`);
      await daily();
      dependencies.setResult({ exitCode: 0 });
    });
};
