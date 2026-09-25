import { BatchLoader } from "./batch-loader.js";
import { TABLE_BY_KIND } from "../../../shared/io/generated/entity-specs.js";
import type { DatabaseClient } from "../../database/index.js";
import {
  readDatabaseRecordByColumns,
  readDatabaseRecordsByColumns,
  readDatabaseRecordsByColumn,
} from "../../database/entities.js";
import type { SupportedTableName } from "../../database/schema.js";

type RowRequest = {
  tableName: SupportedTableName;
  identityColumn: string;
  id: string;
};
type RowReadBatch = {
  tableName: SupportedTableName;
  identityColumn: string;
  ids: string[];
};

function rowKey(input: RowRequest): string {
  return `${input.tableName}:${input.identityColumn}:${input.id}`;
}

function searchRows(result: unknown): Record<string, unknown>[] {
  return typeof result === "object" &&
    result !== null &&
    Array.isArray((result as { rows?: unknown }).rows)
    ? ((result as { rows: Record<string, unknown>[] }).rows ?? [])
    : [];
}

/**
 * Reads a persisted entity's current row by identity, coalescing every read
 * issued during one command into a single batched query (ADR 0019: no startup
 * bulk load; each row is read at most once, lazily). Reads for the same
 * (table, identity column) fold into one `= any($ids)`; reads across tables fold
 * into one `UNION ALL` round-trip. The result is memoized per (table, column,
 * id), so repeated lookups of the same row never re-query.
 */
export class CurrentRowReader {
  private readonly loader = new BatchLoader<
    RowRequest,
    Record<string, unknown>
  >(rowKey, (requests) => this.readBatch(requests));

  constructor(private readonly client: DatabaseClient | undefined) {}

  getById(
    kind: string,
    id: string,
    identityColumn = "id",
  ): Promise<Record<string, unknown> | undefined> {
    return this.rowByColumn(tableForKind(kind), id, identityColumn);
  }

  // The row whose business-key columns hold these values (an entity's unique
  // constraint). Not batched — a business-key lookup is per new record.
  getByColumns(
    kind: string,
    values: Record<string, string>,
  ): Promise<Record<string, unknown> | undefined> {
    return readDatabaseRecordByColumns(
      this.requireClient(),
      tableForKind(kind),
      values,
    );
  }

  // Every row of `kind` satisfying the given column constraints (equality, or set
  // membership for a candidate list) — for the selector resolver, which must see a
  // many-match to fail loud (resolve-or-fail).
  getRowsByColumns(
    kind: string,
    constraints: Record<string, string | readonly string[]>,
  ): Promise<Record<string, unknown>[]> {
    return readDatabaseRecordsByColumns(
      this.requireClient(),
      tableForKind(kind),
      constraints,
    );
  }

  private rowByColumn(
    tableName: SupportedTableName,
    id: string,
    identityColumn = "id",
  ): Promise<Record<string, unknown> | undefined> {
    return this.loader.load({ tableName, identityColumn, id });
  }

  private async readBatch(
    requests: RowRequest[],
  ): Promise<(Record<string, unknown> | undefined)[]> {
    const groups = new Map<string, RowReadBatch>();
    for (const { tableName, identityColumn, id } of requests) {
      const key = `${tableName}:${identityColumn}`;
      let group = groups.get(key);
      if (group === undefined) {
        group = { tableName, identityColumn, ids: [] };
        groups.set(key, group);
      }
      group.ids.push(id);
    }
    const batches = [...groups.values()];
    if (batches.length === 1) {
      const batch = batches[0];
      const rows = await readDatabaseRecordsByColumn(
        this.requireClient(),
        batch.tableName,
        batch.identityColumn,
        batch.ids,
      );
      const byId = new Map(
        rows.map((row) => [String(row[batch.identityColumn]), row]),
      );
      return requests.map(({ id }) => byId.get(id));
    }
    // Fold the pending per-table batches into one UNION ALL round-trip rather
    // than a concurrent query each (which overlaps on the single read client).
    const selects = batches.map(
      (batch, index) =>
        `select ${index} as __batch, row_to_json(t.*) as __row ` +
        `from ${batch.tableName} t where ${batch.identityColumn} = any($${index + 1})`,
    );
    const params = batches.map((batch) => batch.ids);
    const result = await this.requireClient().query(
      selects.join(" union all "),
      params,
    );
    const rowsByKey = new Map<string, Record<string, unknown>>();
    for (const item of searchRows(result)) {
      const batch = batches[Number(item.__batch)];
      const row = (item.__row ?? {}) as Record<string, unknown>;
      const id = row[batch.identityColumn];
      if (id !== undefined && id !== null)
        rowsByKey.set(rowKey({ ...batch, id: String(id) }), row);
    }
    return requests.map((request) => rowsByKey.get(rowKey(request)));
  }

  private requireClient(): DatabaseClient {
    if (this.client === undefined) {
      throw new Error("Database client is required for database reads.");
    }
    return this.client;
  }
}

function tableForKind(kind: string): SupportedTableName {
  const table = TABLE_BY_KIND[kind];
  if (table === undefined) {
    throw new Error(`No table is mapped for record kind ${kind}.`);
  }
  return table as SupportedTableName;
}
