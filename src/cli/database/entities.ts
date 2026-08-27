import type { DatabaseClient } from "./index.js";
import type { SupportedTableName } from "./schema.js";

export type DatabaseRecord = Record<string, unknown> & { id: unknown };

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

export async function readDatabaseRecordByColumn(
  client: DatabaseClient,
  tableName: SupportedTableName,
  columnName: string,
  value: unknown,
): Promise<Record<string, unknown> | undefined> {
  return rowsFromResult(
    await client.query(`select * from ${tableName} where ${columnName} = $1`, [
      value,
    ]),
  )[0];
}

// The row whose business-key columns all hold the given values (the entity's
// unique constraint), or undefined. Column names come from the generated model.
export async function readDatabaseRecordByColumns(
  client: DatabaseClient,
  tableName: SupportedTableName,
  values: Record<string, string>,
): Promise<Record<string, unknown> | undefined> {
  const columns = Object.keys(values);
  const where = columns
    .map((column, index) => `${column} = $${index + 1}`)
    .join(" and ");
  return rowsFromResult(
    await client.query(
      `select * from ${tableName} where ${where} limit 1`,
      columns.map((column) => values[column]),
    ),
  )[0];
}

// Every row whose given columns all satisfy the given constraints — like
// readDatabaseRecordByColumns but without a `limit` (so a selector resolver can see a
// many-match and fail loud), and where a constraint may be a single value (matched by
// equality) or a set of candidate values (matched by membership, `= any`). The set
// form lets a selector's foreign-key hop stay ambiguous while the parent join names
// exactly one row (ADR 0034).
export async function readDatabaseRecordsByColumns(
  client: DatabaseClient,
  tableName: SupportedTableName,
  constraints: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const columns = Object.keys(constraints);
  if (columns.length === 0) {
    return [];
  }
  const where = columns
    .map((column, index) =>
      Array.isArray(constraints[column])
        ? `${column} = any($${index + 1})`
        : `${column} = $${index + 1}`,
    )
    .join(" and ");
  return rowsFromResult(
    await client.query(
      `select * from ${tableName} where ${where}`,
      columns.map((column) => constraints[column]),
    ),
  );
}

export async function readDatabaseRecordsByColumn(
  client: DatabaseClient,
  tableName: SupportedTableName,
  columnName: string,
  values: readonly string[],
): Promise<Record<string, unknown>[]> {
  if (values.length === 0) {
    return [];
  }

  return rowsFromResult(
    await client.query(
      `select * from ${tableName} where ${columnName} = any($1)`,
      [[...new Set(values)]],
    ),
  );
}

// Insert one multi-row statement, doing nothing where `conflictKeyColumn`
// already holds a key. Returns the set of keys actually inserted, so the caller
// can fail loud on any pre-existing key without a separate existence read (the
// key column's unique constraint is the authority). Every record must carry the
// same defined columns — the caller batches by column signature.
export async function createDatabaseRecords(
  client: DatabaseClient,
  tableName: SupportedTableName,
  records: readonly Record<string, unknown>[],
  conflictKeyColumn: string,
): Promise<Set<string>> {
  if (records.length === 0) {
    return new Set();
  }
  const columns = Object.entries(records[0]!)
    .filter(([, value]) => value !== undefined)
    .map(([columnName]) => columnName);
  const values: unknown[] = [];
  const rowClauses = records.map(
    (record) =>
      `(${columns
        .map((columnName) => {
          values.push(record[columnName]);
          return databaseValueExpression(tableName, columnName, values.length);
        })
        .join(", ")})`,
  );
  const result = await client.query(
    `insert into ${tableName} (${columns.join(", ")}) values ${rowClauses.join(
      ", ",
    )} on conflict (${conflictKeyColumn}) do nothing returning ${conflictKeyColumn}`,
    values,
  );
  return new Set(
    rowsFromResult(result).map((row) => String(row[conflictKeyColumn])),
  );
}

export async function updateDatabaseRecordFields(
  client: DatabaseClient,
  tableName: SupportedTableName,
  keyColumnName: string,
  keyValue: unknown,
  values: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return;
  }
  await client.query(
    `update ${tableName} set ${entries
      .map(
        ([columnName], index) =>
          `${columnName} = ${databaseValueExpression(
            tableName,
            columnName,
            index + 2,
          )}`,
      )
      .join(", ")} where ${keyColumnName} = $1`,
    [keyValue, ...entries.map(([, value]) => value)],
  );
}

function databaseValueExpression(
  tableName: SupportedTableName,
  columnName: string,
  parameterIndex: number,
): string {
  if (tableName === "public.location_path" && columnName === "centroid") {
    return `ST_SetSRID(ST_GeomFromGeoJSON($${parameterIndex}), 4326)::geography`;
  }
  if (tableName === "public.location_path" && columnName === "bbox") {
    return `ST_SetSRID(ST_GeomFromGeoJSON($${parameterIndex}), 4326)`;
  }
  if (
    tableName === "public.location_path_geometry" &&
    columnName === "boundary"
  ) {
    return `ST_SetSRID(ST_GeomFromGeoJSON($${parameterIndex}), 4326)`;
  }
  return `$${parameterIndex}`;
}
