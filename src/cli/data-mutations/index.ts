import type { Command } from "commander";
import type {
  CliCommandDependencies,
  CommandResult,
} from "../../shared/cli/types.js";
import {
  defaultDatabaseClientFactory,
  type DatabaseClient,
} from "../database/index.js";
import { applyPending, generateEntry, status, verify } from "./chain.js";

function errorResult(error: unknown): CommandResult {
  return {
    exitCode: 1,
    stderr: `${error instanceof Error ? error.message : String(error)}\n`,
  };
}

async function withClient<T>(
  run: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    throw new Error("DATABASE_URL is required for data-mutations.");
  }
  const client = defaultDatabaseClientFactory(databaseUrl);
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// The ordered, replayable data-mutation chain (ADR 0033): generate the next entry
// from a run's dry envelope, then apply/roll back like schema migrations.
export function registerCliCommand(
  program: Command,
  dependencies: CliCommandDependencies,
): void {
  const group = program
    .command("data-mutations")
    .description("The ordered, replayable data-mutation chain (ADR 0033).");

  group
    .command("generate")
    .description(
      "Append a run's DatabaseMutations envelope (from `run --dry-run`) as the next chain entry.",
    )
    .argument(
      "<mutations-file>",
      "path to the run's DatabaseMutations envelope",
    )
    .action(async (mutationsFile: string): Promise<void> => {
      try {
        const { written, mutationCount } = await generateEntry(mutationsFile);
        dependencies.setResult(
          written === undefined
            ? {
                exitCode: 0,
                stdout: "data-mutations: empty diff — nothing appended.\n",
              }
            : {
                exitCode: 0,
                stdout: `data-mutations: appended ${written} (${mutationCount} mutations).\n`,
              },
        );
      } catch (error) {
        dependencies.setResult(errorResult(error));
      }
    });

  group
    .command("up")
    .description("Apply pending chain entries in order.")
    .option("--to <version>", "apply through this version, then stop")
    .action(async (options: { to?: string }): Promise<void> => {
      try {
        const applied = await withClient((client) =>
          applyPending(client, { to: options.to }),
        );
        dependencies.setResult({
          exitCode: 0,
          stdout:
            applied.length === 0
              ? "data-mutations: up to date.\n"
              : `data-mutations: applied ${applied.length} entrie(s): ${applied
                  .map((entry) => entry.version)
                  .join(", ")}.\n`,
        });
      } catch (error) {
        dependencies.setResult(errorResult(error));
      }
    });

  group
    .command("status")
    .description("Show applied vs pending chain entries.")
    .action(async (): Promise<void> => {
      try {
        const rows = await withClient((client) => status(client));
        const lines = rows.map(
          (row) => `${row.applied ? "[x]" : "[ ]"} ${row.fileName}`,
        );
        dependencies.setResult({
          exitCode: 0,
          stdout: `${
            lines.length === 0 ? "data-mutations: no entries" : lines.join("\n")
          }\n`,
        });
      } catch (error) {
        dependencies.setResult(errorResult(error));
      }
    });

  group
    .command("verify")
    .description("Recompute checksums of applied entries; fail on any drift.")
    .action(async (): Promise<void> => {
      try {
        const drift = await withClient((client) => verify(client));
        dependencies.setResult(
          drift.length === 0
            ? {
                exitCode: 0,
                stdout: "data-mutations: all applied entries verify.\n",
              }
            : {
                exitCode: 1,
                stderr: `data-mutations: checksum drift on applied entries: ${drift.join(", ")}.\n`,
              },
        );
      } catch (error) {
        dependencies.setResult(errorResult(error));
      }
    });
}
