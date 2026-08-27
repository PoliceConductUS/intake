import { createHash } from "node:crypto";
import pg from "pg";

/** One column of an entity table as the database reports it. */
export type IntrospectedColumn = {
  name: string;
  /** pg `udt_name` (e.g. `text`, `float8`, `date`, `timestamptz`, `geometry`). */
  udtName: string;
  nullable: boolean;
  hasDefault: boolean;
};

/** A single entity table's schema truth: columns, non-blank columns, enums. */
export type IntrospectedTable = {
  table: string;
  columns: IntrospectedColumn[];
  /** Columns carrying a `char_length(btrim(col)) > 0` non-blank CHECK. */
  nonBlankColumns: Set<string>;
  /** Columns constrained to a fixed value list via `col = ANY (ARRAY[...])`. */
  enums: Map<string, string[]>;
  /**
   * Bare table names this table references via a foreign key — the database's
   * own dependency edges, used to derive apply order (a referenced table is
   * applied before its referrer). Self-references are omitted.
   */
  references: Set<string>;
  /**
   * Each foreign key as (referencing column → referenced table). Drives both the
   * apply order and the exclusion cascade (a record referencing an excluded
   * record is dropped). Self-references are omitted.
   */
  foreignKeys: Array<{ column: string; targetTable: string }>;
  /**
   * The self-referential FK column (a foreign key back to this same table, e.g.
   * location_path.parent_location_path_id), if any. Kept out of `foreignKeys`
   * (which stays acyclic for apply order) but needed to order a self-referential
   * kind's own rows root-down (ADR 0033).
   */
  selfReferenceColumn?: string;
  /** Unique constraints (excluding the primary key), each as its column list. */
  uniqueKeys: string[][];
};

export type IntrospectedSchema = {
  tables: Map<string, IntrospectedTable>;
  /** Sorted applied-migration versions, and a stable hash of them. */
  migrations: { versions: string[]; fingerprint: string };
};

function stripSchema(qualified: string): string {
  return qualified.includes(".") ? qualified.split(".")[1] : qualified;
}

/** Parses `char_length(btrim(<col>)) > 0` non-blank CHECK definitions. */
function nonBlankColumn(def: string): string | undefined {
  const match = def.match(/char_length\(btrim\(\(?([a-z_]+)\)?\)\)\s*>\s*0/i);
  return match ? match[1] : undefined;
}

/** Parses `<col> = ANY (ARRAY['a'::text, 'b'::text, ...])` enum CHECK values. */
function enumColumn(
  def: string,
): { column: string; values: string[] } | undefined {
  const column = def.match(/\(\(?([a-z_]+)\)?\s*=\s*ANY/i);
  if (column === null) {
    return undefined;
  }
  const values = [...def.matchAll(/'([^']*)'::text/g)].map((m) => m[1]);
  return values.length > 0 ? { column: column[1], values } : undefined;
}

/**
 * Reads the live schema for the given entity tables plus the applied-migration
 * list — the single source of truth the envelope-spec generator matches. The
 * caller supplies schema-qualified table names (`public.agency`); results are
 * keyed by the bare table name.
 */
export async function introspectSchema(
  databaseUrl: string,
  qualifiedTables: string[],
): Promise<IntrospectedSchema> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const tables = new Map<string, IntrospectedTable>();
    // Every public base table, so a ROW type is generated for tables intake does
    // not own but the website reads. spatial_ref_sys is PostGIS system state.
    const systemTables = new Set(["spatial_ref_sys"]);
    const baseTables = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
    );
    const tableNames = baseTables.rows
      .map((row) => row.table_name)
      .filter((name) => !systemTables.has(name));

    // Native pg enum types (CREATE TYPE ... AS ENUM) → their labels, so a column
    // typed by one becomes a union (CHECK-list enums are parsed per-table below).
    const enumTypeRows = await client.query<{ typname: string; label: string }>(
      `select t.typname, e.enumlabel as label
         from pg_type t
         join pg_enum e on e.enumtypid = t.oid
        order by t.typname, e.enumsortorder`,
    );
    const enumTypes = new Map<string, string[]>();
    for (const { typname, label } of enumTypeRows.rows) {
      const labels = enumTypes.get(typname) ?? [];
      labels.push(label);
      enumTypes.set(typname, labels);
    }

    for (const table of tableNames) {
      const columns = await client.query<{
        column_name: string;
        udt_name: string;
        is_nullable: string;
        has_default: boolean;
      }>(
        `select column_name, udt_name, is_nullable,
                (column_default is not null) as has_default
           from information_schema.columns
          where table_schema = 'public' and table_name = $1
          order by ordinal_position`,
        [table],
      );
      if (columns.rowCount === 0) {
        throw new Error(
          `Table public.${table} has no columns (does it exist?).`,
        );
      }

      const checks = await client.query<{ def: string }>(
        `select pg_get_constraintdef(con.oid) as def
           from pg_constraint con
           join pg_class rel on rel.oid = con.conrelid
           join pg_namespace ns on ns.oid = rel.relnamespace
          where ns.nspname = 'public' and rel.relname = $1 and con.contype = 'c'`,
        [table],
      );

      const nonBlankColumns = new Set<string>();
      const enums = new Map<string, string[]>();
      for (const { def } of checks.rows) {
        const nonBlank = nonBlankColumn(def);
        if (nonBlank !== undefined) {
          nonBlankColumns.add(nonBlank);
        }
        const enumCheck = enumColumn(def);
        if (enumCheck !== undefined) {
          enums.set(enumCheck.column, enumCheck.values);
        }
      }
      for (const column of columns.rows) {
        const labels = enumTypes.get(column.udt_name);
        if (labels !== undefined) {
          enums.set(column.column_name, labels);
        }
      }

      const foreignKeyRows = await client.query<{
        column: string;
        ref_table: string;
      }>(
        `select att.attname as column, frel.relname as ref_table
           from pg_constraint con
           join pg_class rel on rel.oid = con.conrelid
           join pg_class frel on frel.oid = con.confrelid
           join pg_namespace ns on ns.oid = rel.relnamespace
           join unnest(con.conkey) as colnum on true
           join pg_attribute att
             on att.attrelid = rel.oid and att.attnum = colnum
          where ns.nspname = 'public' and rel.relname = $1
            and con.contype = 'f'`,
        [table],
      );
      const foreignKeys = foreignKeyRows.rows
        .filter((row) => row.ref_table !== table)
        .map((row) => ({ column: row.column, targetTable: row.ref_table }));
      const references = new Set(foreignKeys.map((fk) => fk.targetTable));
      const selfReferenceColumn = foreignKeyRows.rows.find(
        (row) => row.ref_table === table,
      )?.column;

      // Unique constraints (not the PK) — an entity's business/natural key, used
      // to converge records by find-or-mint at import.
      const uniqueRows = await client.query<{
        conname: string;
        column: string;
      }>(
        `select con.conname, att.attname as column
           from pg_constraint con
           join pg_class rel on rel.oid = con.conrelid
           join pg_namespace ns on ns.oid = rel.relnamespace
           join unnest(con.conkey) with ordinality as u(attnum, ord) on true
           join pg_attribute att
             on att.attrelid = rel.oid and att.attnum = u.attnum
          where ns.nspname = 'public' and rel.relname = $1 and con.contype = 'u'
          order by con.conname, u.ord`,
        [table],
      );
      const uniqueKeysByName = new Map<string, string[]>();
      for (const row of uniqueRows.rows) {
        const columns = uniqueKeysByName.get(row.conname) ?? [];
        columns.push(row.column);
        uniqueKeysByName.set(row.conname, columns);
      }
      const uniqueKeys = [...uniqueKeysByName.values()];

      tables.set(table, {
        table,
        columns: columns.rows.map((row) => ({
          name: row.column_name,
          udtName: row.udt_name,
          nullable: row.is_nullable === "YES",
          hasDefault: row.has_default,
        })),
        nonBlankColumns,
        enums,
        references,
        foreignKeys,
        selfReferenceColumn,
        uniqueKeys,
      });
    }

    for (const qualified of qualifiedTables) {
      const entityTable = stripSchema(qualified);
      if (!tables.has(entityTable)) {
        throw new Error(
          `Entity table public.${entityTable} was not found among the schema's base tables.`,
        );
      }
    }

    const migrationRows = await client.query<{ version: string }>(
      `select version from supabase_migrations.schema_migrations order by version`,
    );
    const versions = migrationRows.rows.map((row) => row.version);
    const fingerprint = createHash("sha256")
      .update(versions.join("\n"))
      .digest("hex");

    return { tables, migrations: { versions, fingerprint } };
  } finally {
    await client.end();
  }
}
