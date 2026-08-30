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
      "Produce a source's Artifacts from its latest acquired input (no chain, no apply). With no <source>, transforms every source in dependency order, skipping any not yet acquired.",
    )
    .argument("[source]", "source id under sources/; omit to transform all")
    .action(async (source: string | undefined): Promise<void> => {
      try {
        if (source !== undefined) {
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
          return;
        }
        // No source given: transform every source in dependency order. A source
        // with no acquired input is skipped (you transform what has been acquired);
        // only a real transform failure errors the run.
        const transformed: string[] = [];
        const skipped: string[] = [];
        const errored: string[] = [];
        for (const id of await orderedSourceIds()) {
          consoleLogger.info(`${id}: transform`);
          let result;
          try {
            result = await transformOneSource(id, process.env, consoleLogger);
          } catch (error) {
            skipped.push(
              `${id} (${error instanceof Error ? error.message.trim() : String(error)})`,
            );
            continue;
          }
          if ("error" in result) {
            errored.push(`${id} (${result.error.stderr?.trim() ?? "failed"})`);
            continue;
          }
          transformed.push(id);
          consoleLogger.info(`  transformed ${id}`);
        }
        const summary =
          `data: transformed ${transformed.length} source(s):\n` +
          transformed.map((id) => `  + ${id}`).join("\n") +
          (skipped.length > 0 ? `\nskipped: ${skipped.join(", ")}` : "") +
          (errored.length > 0 ? `\nerrored: ${errored.join(", ")}` : "") +
          "\n";
        dependencies.setResult(
          errored.length > 0
            ? { exitCode: 1, stderr: summary }
            : { exitCode: 0, stdout: summary },
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
        // An empty diff is a legitimate no-op (a source unchanged since it was last
        // applied, or one with no acquired input); an error is a broken source. They
        // must not be conflated — a rebuild that hides an errored source behind a
        // green exit defeats the reconstruction gate.
        const emptyDiff: string[] = [];
        const errored: string[] = [];
        for (const source of await orderedSourceIds()) {
          consoleLogger.info(`${source}: transform`);
          const transformed = await transformOneSource(
            source,
            process.env,
            consoleLogger,
          );
          if ("error" in transformed) {
            errored.push(
              `${source} (transform: ${transformed.error.stderr?.trim() ?? "failed"})`,
            );
            consoleLogger.info(
              `  ${source} errored: ${transformed.error.stderr?.trim() ?? "transform failed"}`,
            );
            continue;
          }
          await withClient((client) => assertAtHead(client));
          const generated = await generateOneSource(source, process.env);
          if ("error" in generated) {
            errored.push(
              `${source} (generate: ${generated.error.stderr?.trim() ?? "failed"})`,
            );
            continue;
          }
          if (generated.version === undefined) {
            emptyDiff.push(source);
            continue;
          }
          await withClient((client) => applyPending(client, {}));
          done.push(`${generated.version} ${source}`);
          consoleLogger.info(`  applied ${generated.version} ${source}`);
        }
        const summary =
          `data: rebuilt ${done.length} entrie(s):\n` +
          done.map((entry) => `  + ${entry}`).join("\n") +
          (emptyDiff.length > 0
            ? `\nempty diff (nothing to apply): ${emptyDiff.join(", ")}`
            : "") +
          (errored.length > 0 ? `\nerrored: ${errored.join(", ")}` : "") +
          "\n";
        // Any errored source fails the whole rebuild loud (non-zero); empty diffs
        // are fine.
        dependencies.setResult(
          errored.length > 0
            ? { exitCode: 1, stderr: summary }
            : { exitCode: 0, stdout: summary },
        );
      } catch (error) {
        dependencies.setResult(errorResult(error));
      }
    });
}
