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

// `DatabaseClient.query` returns an opaque driver result; this narrows it to its
// `rows` (empty when absent). The single reader every caller shares.
export function rowsFromResult(result: unknown): Record<string, unknown>[] {
  return typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray((result as { rows?: unknown[] }).rows)
    ? (result as { rows: Record<string, unknown>[] }).rows
    : [];
}

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
  // A connection-level failure (the DB restarting, an idle drop) emits an 'error'
  // event on the client. With no listener Node treats it as fatal and aborts the
  // process — enough to kill a multi-hour command over a momentary blip. Capture
  // it so the *next* query rejects with a clear message instead; in-flight and
  // future queries reject on their own.
  let connectionError: Error | undefined;
  client.on("error", (error: Error) => {
    connectionError = error;
  });
  let tail: Promise<unknown> = Promise.resolve();
  return {
    connect: () => client.connect(),
    end: () => client.end(),
    query: (text, values) => {
      const result = tail.then(() => {
        if (connectionError !== undefined) {
          throw new Error(
            `Database connection lost: ${connectionError.message}`,
          );
        }
        return values === undefined
          ? client.query(text)
          : client.query(text, values as unknown[]);
      });
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
