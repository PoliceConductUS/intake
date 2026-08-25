import { TABLE_BY_KIND } from "../../../shared/io/generated/entity-specs.js";
import type { DatabaseClient } from "../../database/index.js";
import { readDatabaseRecordsByColumn } from "../../database/entities.js";
import type { SupportedTableName } from "../../database/schema.js";

type RowReadBatch = {
  tableName: SupportedTableName;
  identityColumn: string;
  requests: Map<
    string,
    {
      resolve: (row: Record<string, unknown> | undefined) => void;
      reject: (error: unknown) => void;
    }
  >;
};

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
  private readonly cache = new Map<
    string,
    Promise<Record<string, unknown> | undefined>
  >();
  private readonly pending = new Map<string, RowReadBatch>();
  private flushScheduled = false;

  constructor(private readonly client: DatabaseClient | undefined) {}

  getById(
    kind: string,
    id: string,
    identityColumn = "id",
  ): Promise<Record<string, unknown> | undefined> {
    return this.rowByColumn(tableForKind(kind), id, identityColumn);
  }

  private rowByColumn(
    tableName: SupportedTableName,
    id: string,
    identityColumn = "id",
  ): Promise<Record<string, unknown> | undefined> {
    const cacheKey = `${tableName}:${identityColumn}:${id}`;
    let pending = this.cache.get(cacheKey);
    if (pending === undefined) {
      pending = this.enqueue(tableName, identityColumn, id);
      this.cache.set(cacheKey, pending);
    }
    return pending;
  }

  private enqueue(
    tableName: SupportedTableName,
    identityColumn: string,
    id: string,
  ): Promise<Record<string, unknown> | undefined> {
    const batchKey = `${tableName}:${identityColumn}`;
    let batch = this.pending.get(batchKey);
    if (batch === undefined) {
      batch = { tableName, identityColumn, requests: new Map() };
      this.pending.set(batchKey, batch);
    }
    return new Promise((resolve, reject) => {
      batch.requests.set(id, { resolve, reject });
      if (!this.flushScheduled) {
        this.flushScheduled = true;
        // setImmediate, not queueMicrotask: a group's facades reach this read
        // spread across many microtasks (FK and slug resolution), so a microtask
        // flush fires before they gather and each read runs alone. Deferring to
        // the macrotask boundary lets the whole group batch into one query.
        setImmediate(() => void this.flush());
      }
    });
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    const batches = [...this.pending.values()].filter(
      (batch) => batch.requests.size > 0,
    );
    this.pending.clear();
    if (batches.length === 0) return;
    if (batches.length === 1) {
      await this.runBatch(batches[0]);
      return;
    }
    // Fold the pending per-table batches into one UNION ALL round-trip rather
    // than a concurrent query each (which overlaps on the single read client).
    const selects = batches.map(
      (batch, index) =>
        `select ${index} as __batch, row_to_json(t.*) as __row ` +
        `from ${batch.tableName} t where ${batch.identityColumn} = any($${index + 1})`,
    );
    const params = batches.map((batch) => [...new Set(batch.requests.keys())]);
    try {
      const result = await this.requireClient().query(
        selects.join(" union all "),
        params,
      );
      const rowsByBatch = batches.map(
        () => new Map<string, Record<string, unknown>>(),
      );
      for (const item of searchRows(result)) {
        const index = Number(item.__batch);
        const row = (item.__row ?? {}) as Record<string, unknown>;
        const id = row[batches[index].identityColumn];
        if (id !== undefined && id !== null) {
          rowsByBatch[index].set(String(id), row);
        }
      }
      batches.forEach((batch, index) => {
        for (const [id, request] of batch.requests) {
          request.resolve(rowsByBatch[index].get(id));
        }
      });
    } catch (error) {
      for (const batch of batches) {
        for (const request of batch.requests.values()) request.reject(error);
      }
    }
  }

  private async runBatch(batch: RowReadBatch): Promise<void> {
    try {
      const rows = await readDatabaseRecordsByColumn(
        this.requireClient(),
        batch.tableName,
        batch.identityColumn,
        [...batch.requests.keys()],
      );
      const rowByKey = new Map(
        rows.map((row) => [String(row[batch.identityColumn]), row] as const),
      );
      for (const [id, request] of batch.requests) {
        request.resolve(rowByKey.get(id));
      }
    } catch (error) {
      for (const request of batch.requests.values()) {
        request.reject(error);
      }
    }
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
