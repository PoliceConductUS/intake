import path from "node:path";
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
  program
    .command("sources")
    .description(
      "List the sources under sources/ with the phases each supports " +
        "(acquire/run) and its description, generated from the source modules.",
    )
    .action(async (): Promise<void> => {
      const sourcesRoot = path.join(process.cwd(), "sources");
      const sources = await describeSources(sourcesRoot);
      dependencies.setResult({
        exitCode: 0,
        stdout: renderSourceCatalog(sources),
      });
    });
};
