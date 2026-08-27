import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseClient } from "./index.js";

// Schema-migration application (ADR 0033: schema migrations are their own chain,
// applied before the data-mutation chain). All access to
// supabase_migrations.schema_migrations and DDL lives here, inside the database
// package (architecture boundary).

function resultRows(result: unknown): Record<string, unknown>[] {
  return typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray((result as { rows?: unknown[] }).rows)
    ? (result as { rows: Record<string, unknown>[] }).rows
    : [];
}

/** A migration file `<version>_<name>.sql` split into its version and name. */
function parseMigrationFile(file: string): { version: string; name: string } {
  const separator = file.indexOf("_");
  return {
    version: file.slice(0, separator),
    name: file.slice(separator + 1, -".sql".length),
  };
}

/**
 * Apply every schema migration not yet recorded in
 * supabase_migrations.schema_migrations, in filename order, recording each — the
 * schema half of a reconstruction. Idempotent: on a fresh database it applies the
 * whole set; on a partly-migrated one it applies only the pending tail. Ensures the
 * PostGIS extension and the ledger table exist first so a truly blank database
 * reconstructs. Returns the versions newly applied.
 */
export async function applyPendingSchemaMigrations(
  client: DatabaseClient,
  migrationsDirectory: string,
): Promise<string[]> {
  await client.query("create extension if not exists postgis");
  await client.query("create schema if not exists supabase_migrations");
  await client.query(
    `create table if not exists supabase_migrations.schema_migrations (
       version text primary key,
       statements text[],
       name text
     )`,
  );

  const applied = new Set(
    resultRows(
      await client.query(
        "select version from supabase_migrations.schema_migrations",
      ),
    ).map((row) => String(row.version)),
  );

  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    const { version, name } = parseMigrationFile(file);
    if (applied.has(version)) {
      continue;
    }
    const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
    await client.query(sql);
    await client.query(
      `insert into supabase_migrations.schema_migrations (version, name)
         values ($1, $2) on conflict do nothing`,
      [version, name],
    );
    newlyApplied.push(version);
  }
  return newlyApplied;
}

/**
 * Reset the database to a blank, freshly-migrated schema: drop the public and
 * supabase_migrations schemas, recreate public, then apply every schema migration.
 * Destructive — it discards all data (and the data-mutation ledger). Returns the
 * applied migration versions.
 */
export async function resetDatabaseSchema(
  client: DatabaseClient,
  migrationsDirectory: string,
): Promise<string[]> {
  await client.query("drop schema if exists public cascade");
  await client.query("drop schema if exists supabase_migrations cascade");
  await client.query("create schema public");
  return applyPendingSchemaMigrations(client, migrationsDirectory);
}
