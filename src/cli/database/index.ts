import pg from "pg";

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
