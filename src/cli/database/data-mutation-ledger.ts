import { rowsFromResult, type DatabaseClient } from "./index.js";

// The data-mutation chain ledger (ADR 0033). All access to
// public.data_mutation_applied and the schema-version read lives here, inside the
// database package (architecture boundary).

/** The highest applied schema-migration version (a data mutation gates on ≥ this). */
export async function readCurrentSchemaVersion(
  client: DatabaseClient,
): Promise<string> {
  const result = await client.query(
    "select max(version) as version from supabase_migrations.schema_migrations",
  );
  const version = rowsFromResult(result)[0]?.version;
  return typeof version === "string" ? version : "";
}

export async function readAppliedDataMutationVersions(
  client: DatabaseClient,
): Promise<Set<string>> {
  const result = await client.query(
    "select version from public.data_mutation_applied",
  );
  return new Set(rowsFromResult(result).map((row) => String(row.version)));
}

export async function readAppliedDataMutationChecksums(
  client: DatabaseClient,
): Promise<Map<string, string>> {
  const result = await client.query(
    "select version, checksum from public.data_mutation_applied",
  );
  return new Map(
    rowsFromResult(result).map((row) => [
      String(row.version),
      String(row.checksum),
    ]),
  );
}

export async function recordDataMutationApplied(
  client: DatabaseClient,
  entry: { version: string; previousVersion: string | null; checksum: string },
): Promise<void> {
  await client.query(
    `insert into public.data_mutation_applied (version, previous_version, checksum)
       values ($1, $2, $3)`,
    [entry.version, entry.previousVersion, entry.checksum],
  );
}
