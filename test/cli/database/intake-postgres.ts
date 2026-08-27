import { execSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GENERATED_MIGRATION_VERSIONS } from "../../../src/shared/io/generated/entity-specs.js";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../supabase/migrations", import.meta.url),
);

async function readMigrationsInOrder(): Promise<
  { name: string; sql: string }[]
> {
  const entries = await readdir(MIGRATIONS_DIR);
  const files = entries.filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (name) => ({
      name,
      sql: await readFile(path.join(MIGRATIONS_DIR, name), "utf8"),
    })),
  );
}

const INTAKE_TABLES = [
  "public.coverage_link_agency_personnel",
  "public.discipline_agency_personnel",
  "public.coverage_links",
  "public.discipline",
  "public.agency_personnel",
  "public.license_action",
  "public.license",
  "public.authority_license",
  "public.personnel",
  "public.agency",
  "public.licensing_authority",
  "public.location_path_geometry",
  "public.location_path_alias",
  "public.location_path_closure",
  "public.location_path",
];

export function dockerAvailable(): boolean {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export type IntakeDatabase = {
  connectionString: string;
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
  truncateAll: () => Promise<void>;
  stop: () => Promise<void>;
};

// Start a real PostGIS container provisioned with the intake public schema, so
// the replay/apply path is exercised against genuine Postgres (multi-row inserts,
// ON CONFLICT, FK and NOT NULL constraints, PostGIS geometry) instead of a mock.
export async function startIntakeDatabase(): Promise<IntakeDatabase> {
  const container = await new PostgreSqlContainer(
    "postgis/postgis:15-3.4",
  ).start();
  const connectionString = container.getConnectionUri();
  const admin = new pg.Client({ connectionString });
  await admin.connect();
  await admin.query("create extension if not exists postgis;");
  // Provision the schema by applying the real migrations in filename order, so the
  // container's schema is exactly what the migrations produce (no drift from a
  // hand-maintained dump). The migrations define generate_cuid() themselves.
  for (const migration of await readMigrationsInOrder()) {
    try {
      await admin.query(migration.sql);
    } catch (error) {
      throw new Error(
        `Failed to apply migration ${migration.name}: ${String(error)}`,
      );
    }
  }
  await admin.query("set search_path to public");
  // The import pipeline verifies the database's applied migrations match the
  // generated envelope specs, so provision the same versions it expects.
  await admin.query("create schema if not exists supabase_migrations");
  await admin.query(
    "create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)",
  );
  for (const version of GENERATED_MIGRATION_VERSIONS) {
    await admin.query(
      "insert into supabase_migrations.schema_migrations (version) values ($1) on conflict do nothing",
      [version],
    );
  }

  return {
    connectionString,
    query: (text, values) =>
      admin.query(text, values === undefined ? undefined : [...values]),
    truncateAll: async () => {
      await admin.query(
        `truncate ${INTAKE_TABLES.join(", ")} restart identity cascade`,
      );
    },
    stop: async () => {
      await admin.end();
      await container.stop();
    },
  };
}
