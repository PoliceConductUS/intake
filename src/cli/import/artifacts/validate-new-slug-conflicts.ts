import {
  type DatabaseRecord,
  readDatabaseRecordsBySlugs,
  readNewDatabaseRecords,
} from "../../database/entities.js";
import type { DatabaseClient } from "../../database/index.js";
import type { SupportedTableName } from "../../database/schema.js";
import type { ImportRows } from "./transform.js";

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }

  return [...duplicates];
}

async function newRowsForTable(
  client: DatabaseClient,
  tableName: SupportedTableName,
  rows: DatabaseRecord[],
): Promise<DatabaseRecord[]> {
  return readNewDatabaseRecords(client, tableName, rows);
}

async function validateNewRowSlugConflicts(
  client: DatabaseClient,
  tableName: "public.agency" | "public.officers",
  rows: Record<string, unknown>[],
): Promise<string[]> {
  const rowsWithSlugs = rows
    .map((row) => ({ row, slug: valueAsString(row.slug) }))
    .filter(
      (entry): entry is { row: Record<string, unknown>; slug: string } =>
        entry.slug !== undefined,
    );
  const slugs = rowsWithSlugs.map(({ slug }) => slug);
  const errors: string[] = [];

  for (const duplicateSlug of duplicateValues(slugs)) {
    const rowIds = rowsWithSlugs
      .filter(({ slug }) => slug === duplicateSlug)
      .map(({ row }) => String(row.id));
    errors.push(
      `Cannot prepare import; slug ${duplicateSlug} appears on multiple new ${tableName} rows ${rowIds.join(", ")}.`,
    );
  }

  const uniqueSlugs = uniqueValues(slugs);
  if (uniqueSlugs.length === 0) {
    return errors;
  }

  const existingRows = await readDatabaseRecordsBySlugs(
    client,
    tableName,
    uniqueSlugs,
  );
  const existingBySlug = new Map(
    existingRows
      .map((row) => [valueAsString(row.slug), valueAsString(row.id)] as const)
      .filter(
        (entry): entry is readonly [string, string] =>
          entry[0] !== undefined && entry[1] !== undefined,
      ),
  );

  for (const { row, slug } of rowsWithSlugs) {
    const existingId = existingBySlug.get(slug);
    if (existingId !== undefined && existingId !== row.id) {
      errors.push(
        `Cannot insert ${tableName} ${String(row.id)}; slug ${slug} already belongs to ${tableName} ${existingId}.`,
      );
    }
  }

  return errors;
}

export async function validatePreparedNewSlugConflicts(
  client: DatabaseClient,
  rows: ImportRows,
): Promise<string[]> {
  const newAgencies = await newRowsForTable(
    client,
    "public.agency",
    rows.agencies,
  );
  const newOfficers = await newRowsForTable(
    client,
    "public.officers",
    rows.officers,
  );

  return [
    ...(await validateNewRowSlugConflicts(
      client,
      "public.agency",
      newAgencies,
    )),
    ...(await validateNewRowSlugConflicts(
      client,
      "public.officers",
      newOfficers,
    )),
  ];
}
