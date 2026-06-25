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

export async function readDatabaseRecordById(
  client: DatabaseClient,
  tableName: SupportedTableName,
  rowId: unknown,
): Promise<Record<string, unknown> | undefined> {
  return rowsFromResult(
    await client.query(`select * from ${tableName} where id = $1`, [rowId]),
  )[0];
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

export async function readDatabaseRecordsByIds(
  client: DatabaseClient,
  tableName: SupportedTableName,
  rowIds: readonly string[],
): Promise<Record<string, unknown>[]> {
  if (rowIds.length === 0) {
    return [];
  }

  return rowsFromResult(
    await client.query(`select * from ${tableName} where id = any($1)`, [
      [...new Set(rowIds)],
    ]),
  );
}

export async function readNewDatabaseRecords(
  client: DatabaseClient,
  tableName: SupportedTableName,
  rows: readonly DatabaseRecord[],
): Promise<DatabaseRecord[]> {
  const newRows: DatabaseRecord[] = [];

  for (const row of rows) {
    const existingRow = await readDatabaseRecordById(client, tableName, row.id);
    if (existingRow === undefined) {
      newRows.push(row);
    }
  }

  return newRows;
}

export async function readDatabaseRecordsBySlugs(
  client: DatabaseClient,
  tableName: "public.agency" | "public.officers",
  slugs: readonly string[],
): Promise<Record<string, unknown>[]> {
  return rowsFromResult(
    await client.query(
      `select id, slug from ${tableName} where slug = any($1)`,
      [slugs],
    ),
  );
}

export async function createDatabaseRecord(
  client: DatabaseClient,
  tableName: SupportedTableName,
  record: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(record).filter(
    ([, value]) => value !== undefined,
  );
  await client.query(
    `insert into ${tableName} (${entries
      .map(([columnName]) => columnName)
      .join(", ")}) values (${entries
      .map(([columnName], index) =>
        databaseValueExpression(tableName, columnName, index + 1),
      )
      .join(", ")})`,
    entries.map(([, value]) => value),
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
