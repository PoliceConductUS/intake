import type { DatabaseClient } from "./index.js";

// The whitelist of writable/readable entity tables is generated from the schema
// (one union per entity table) so it can never drift from the model.
export type { SupportedTableName } from "../../shared/io/generated/entity-specs.js";

export type ImportDatabaseSchema = {
  appliedMigrations: {
    version: string;
    name: string | null;
  }[];
};

export type DatabaseSchemaMetadata = {
  importSchema: ImportDatabaseSchema;
};

function rowsFromResult(
  result: { rows?: Record<string, unknown>[] } | unknown,
): Record<string, unknown>[] {
  return typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray(result.rows)
    ? result.rows
    : [];
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

async function loadAppliedMigrations(
  client: DatabaseClient,
): Promise<ImportDatabaseSchema["appliedMigrations"]> {
  const result = await client.query(
    `select version, name
       from supabase_migrations.schema_migrations
      order by version`,
  );

  return rowsFromResult(result)
    .map((row) => ({
      version: valueAsString(row.version),
      name:
        typeof row.name === "string" && row.name.trim().length > 0
          ? row.name
          : null,
    }))
    .filter(
      (migration): migration is { version: string; name: string | null } =>
        migration.version !== undefined,
    );
}

export async function loadDatabaseSchemaMetadata(
  client: DatabaseClient,
): Promise<DatabaseSchemaMetadata> {
  return {
    importSchema: {
      appliedMigrations: await loadAppliedMigrations(client),
    },
  };
}
