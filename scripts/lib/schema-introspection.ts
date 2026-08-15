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
    for (const qualified of qualifiedTables) {
      const table = stripSchema(qualified);

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
      });
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
