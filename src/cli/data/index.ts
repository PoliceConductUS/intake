import type { Command } from "commander";
import type {
  CliCommandDependencies,
  CommandResult,
} from "../../shared/cli/types.js";
import {
  defaultDatabaseClientFactory,
  type DatabaseClient,
} from "../database/index.js";
import { applyPending, assertAtHead, status, verify } from "./chain.js";
import {
  generateOneSource,
  orderedSourceIds,
  transformOneSource,
} from "./source-pipeline.js";
import { registerAcquireCommand } from "../acquire/index.js";

const consoleLogger = {
  info: (message: string) => process.stderr.write(`${message}\n`),
};

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
    throw new Error("DATABASE_URL is required for data.");
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
    .command("data")
    .description(
      "The data pipeline (ADR 0033/0034): acquire → transform → generate → up.",
    );

  // acquire → transform → generate → up: the phases, in order. acquire lives in its
  // own module; the rest are below.
  registerAcquireCommand(group, dependencies);

  group
    .command("transform")
    .description(
      "Run a source's run.ts against its latest acquired input to produce its Artifacts (no chain, no apply).",
    )
    .argument("<source>", "source id under sources/")
    .action(async (source: string): Promise<void> => {
      try {
        const result = await transformOneSource(
          source,
          process.env,
          consoleLogger,
        );
        dependencies.setResult(
          "error" in result
            ? result.error
            : {
                exitCode: 0,
                stdout: `data: transformed ${source} → ${result.artifactsPath}\n`,
              },
        );
      } catch (error) {
        dependencies.setResult(errorResult(error));
      }
    });

  group
    .command("generate")
    .description(
      "Write the next migration: diff a source's transform Artifacts against the database at head and append the delta to the chain. Does not apply it — run `data up` for that.",
    )
    .argument("<source>", "source id under sources/")
    .action(async (source: string): Promise<void> => {
      try {
        await withClient((client) => assertAtHead(client));
        const result = await generateOneSource(source, process.env);
        dependencies.setResult(
          "error" in result
            ? result.error
            : result.version === undefined
              ? {
                  exitCode: 0,
                  stdout: `data: ${source} — empty diff, nothing appended.\n`,
                }
              : {
                  exitCode: 0,
                  stdout: `data: appended ${result.version} (${result.mutationCount} mutations).\n`,
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
              ? "data: up to date.\n"
              : `data: applied ${applied.length} entrie(s): ${applied
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
            lines.length === 0 ? "data: no entries" : lines.join("\n")
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
                stdout: "data: all applied entries verify.\n",
              }
            : {
                exitCode: 1,
                stderr: `data: checksum drift on applied entries: ${drift.join(", ")}.\n`,
              },
        );
      } catch (error) {
        dependencies.setResult(errorResult(error));
      }
    });

  group
    .command("rebuild")
    .description(
      "Rebuild the chain from sources: for each source in dependency order, transform → generate → up. Assumes an externally-migrated database (typically blank); a producer is applied before a consumer transforms against it.",
    )
    .action(async (): Promise<void> => {
      try {
        const done: string[] = [];
        const skipped: string[] = [];
        for (const source of await orderedSourceIds()) {
          consoleLogger.info(`${source}: transform`);
          const transformed = await transformOneSource(
            source,
            process.env,
            consoleLogger,
          );
          if ("error" in transformed) {
            skipped.push(`${source} (transform)`);
            consoleLogger.info(
              `  ${source} skipped: ${transformed.error.stderr?.trim() ?? "transform failed"}`,
            );
            continue;
          }
          await withClient((client) => assertAtHead(client));
          const generated = await generateOneSource(source, process.env);
          if ("error" in generated) {
            skipped.push(`${source} (generate)`);
            continue;
          }
          if (generated.version === undefined) {
            skipped.push(`${source} (empty)`);
            continue;
          }
          await withClient((client) => applyPending(client, {}));
          done.push(`${generated.version} ${source}`);
          consoleLogger.info(`  applied ${generated.version} ${source}`);
        }
        dependencies.setResult({
          exitCode: 0,
          stdout:
            `data: rebuilt ${done.length} entrie(s):\n` +
            done.map((entry) => `  + ${entry}`).join("\n") +
            (skipped.length > 0 ? `\nskipped: ${skipped.join(", ")}` : "") +
            "\n",
        });
      } catch (error) {
        dependencies.setResult(errorResult(error));
      }
    });
}
