import path from "node:path";
import type { Command } from "commander";
import type {
  CliCommandDependencies,
  CommandResult,
} from "../../shared/cli/types.js";
import {
  defaultDatabaseClientFactory,
  type DatabaseClient,
} from "../database/index.js";
import {
  applyPendingSchemaMigrations,
  resetDatabaseSchema,
} from "../database/schema-migrations.js";
import { applyPending } from "../data-mutations/chain.js";

const DEFAULT_MIGRATIONS_DIRECTORY = "supabase/migrations";

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
    throw new Error("DATABASE_URL is required for db commands.");
  }
  const client = defaultDatabaseClientFactory(databaseUrl);
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// Database lifecycle commands. Schema migrations are the schema chain (applied
// first); the data-mutation chain is the data history (ADR 0033/0034).
export function registerCliCommand(
  program: Command,
  dependencies: CliCommandDependencies,
): void {
  const group = program.command("db").description("Database lifecycle commands.");

  group
    .command("reset")
    .description(
      "Drop everything and re-apply the schema migrations — a blank, migrated database (no data).",
    )
    .option(
      "--migrations <dir>",
      "schema migrations directory",
      DEFAULT_MIGRATIONS_DIRECTORY,
    )
    .action(async (options: { migrations: string }): Promise<void> => {
      try {
        const applied = await withClient((client) =>
          resetDatabaseSchema(client, path.resolve(options.migrations)),
        );
        dependencies.setResult({
          exitCode: 0,
          stdout: `db: reset and applied ${applied.length} schema migration(s).\n`,
        });
      } catch (error) {
        dependencies.setResult(errorResult(error));
      }
    });

  group
    .command("reconstruct")
    .description(
      "Rebuild the database from scratch: reset, apply the schema migrations, then replay the whole data-mutation chain (like `liquibase update`).",
    )
    .option(
      "--migrations <dir>",
      "schema migrations directory",
      DEFAULT_MIGRATIONS_DIRECTORY,
    )
    .action(async (options: { migrations: string }): Promise<void> => {
      try {
        const { migrations, entries } = await withClient(async (client) => {
          const migrations = await resetDatabaseSchema(
            client,
            path.resolve(options.migrations),
          );
          const entries = await applyPending(client, {});
          return { migrations, entries };
        });
        dependencies.setResult({
          exitCode: 0,
          stdout: `db: reconstructed — ${migrations.length} schema migration(s), ${entries.length} data-mutation entrie(s) replayed.\n`,
        });
      } catch (error) {
        dependencies.setResult(errorResult(error));
      }
    });

  group
    .command("migrate")
    .description(
      "Apply any pending schema migrations to the current database (non-destructive).",
    )
    .option(
      "--migrations <dir>",
      "schema migrations directory",
      DEFAULT_MIGRATIONS_DIRECTORY,
    )
    .action(async (options: { migrations: string }): Promise<void> => {
      try {
        const applied = await withClient((client) =>
          applyPendingSchemaMigrations(client, path.resolve(options.migrations)),
        );
        dependencies.setResult({
          exitCode: 0,
          stdout:
            applied.length === 0
              ? "db: schema is up to date.\n"
              : `db: applied ${applied.length} schema migration(s): ${applied.join(", ")}.\n`,
        });
      } catch (error) {
        dependencies.setResult(errorResult(error));
      }
    });
}
