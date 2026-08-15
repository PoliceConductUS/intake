import pg from "pg";

// Return SQL `date` columns (OID 1082) as their raw "YYYY-MM-DD" string instead
// of a JS `Date`. Intake models dates as strings — the artifact specs and the
// mutation `from`/`to` values are strings — so the read side must match; a `Date`
// object would fail the string field schemas when diffed against desired values.
pg.types.setTypeParser(1082, (value) => value);

export type DatabaseClient = {
  connect(): Promise<unknown>;
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows?: Record<string, unknown>[] } | unknown>;
  end(): Promise<void>;
};

export type DatabaseClientFactory = (databaseUrl: string) => DatabaseClient;

export function defaultDatabaseClientFactory(
  databaseUrl: string,
): DatabaseClient {
  return new pg.Client({ connectionString: databaseUrl });
}
