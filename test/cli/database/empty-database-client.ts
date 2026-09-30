import type { DatabaseClient } from "../../../src/cli/database/index.js";

/** A database client backed by an empty database: every query returns no rows. */
export class EmptyDatabaseClient implements DatabaseClient {
  async connect(): Promise<void> {}

  async query(
    _text = "",
    _values: readonly unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[] }> {
    return { rows: [] };
  }

  async end(): Promise<void> {}
}
