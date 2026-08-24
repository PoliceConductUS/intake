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
  return serializeQueries(new pg.Client({ connectionString: databaseUrl }));
}

// A single pg.Client cannot run overlapping queries; facades drain concurrently
// (Promise.all), so chain each query after the previous one settles. pg queued
// them internally already, but doing it here drops the deprecation warning and
// is safe for pg@9.
function serializeQueries(client: pg.Client): DatabaseClient {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    connect: () => client.connect(),
    end: () => client.end(),
    query: (text, values) => {
      const result = tail.then(() =>
        values === undefined
          ? client.query(text)
          : client.query(text, values as unknown[]),
      );
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
