import type {
  IntrospectedSchema,
  IntrospectedTable,
} from "./schema-introspection.js";
import {
  IMPORT_ARTIFACT_KINDS,
  importTypeMetadata,
} from "../../src/shared/io/import-type-metadata.js";

// Columns the database manages; a source never supplies them.
const DB_MANAGED = new Set(["created_at", "updated_at"]);

// Columns intake always computes during import — a source can't supply them: the
// slug is generated, and location_path_id is our internal id for a place in the
// census hierarchy, which a source has no way to know. (Coordinates are NOT here:
// a source that has lat/lng should send them; otherwise we geocode.)
const INTAKE_COMPUTED = new Set(["slug", "location_path_id"]);

// Fields a source may supply but is not required to — a valid row has them, but
// they can be derived from the other fields when a source doesn't have them.
const PROVIDER_OPTIONAL = new Set(["latitude", "longitude"]);

// `RecordKind.field` entries the database allows to be null but the data request
// requires from a provider — a source export should carry them even where intake
// itself tolerates their absence (e.g. an officer's last name).
const SPEC_REQUIRED = new Set(["Personnel.last_name"]);

// Census-owned geography kinds a data provider never supplies (we build them from
// the Census Gazetteer); omit them from a provider-facing request document.
const OMITTED_KINDS = new Set([
  "LocationPath",
  "LocationPathGeometry",
  "LocationPathAlias",
]);

// The identity column per record kind (the source's own stable id for the
// record). `id` for canonical entities; the natural key for the census kinds.
function identityColumn(recordKind: string): string {
  if (recordKind === "LocationPath") return "location_path_id";
  if (recordKind === "LocationPathAlias") return "alias_path";
  return "id";
}

function bareTable(qualified: string): string {
  return qualified.replace(/^public\./, "");
}

const recordKindByTable = new Map<string, string>(
  Object.values(importTypeMetadata).map((meta) => [
    bareTable(meta.targetTable ?? ""),
    meta.recordKind,
  ]),
);

function fieldType(table: IntrospectedTable, columnName: string): string {
  const enumValues = table.enums.get(columnName);
  if (enumValues !== undefined) {
    return `one of: ${enumValues.map((value) => `\`${value}\``).join(", ")}`;
  }
  const column = table.columns.find((candidate) => candidate.name === columnName);
  const udt = column?.udtName ?? "text";
  const isArray = udt.startsWith("_");
  const scalar = isArray ? udt.slice(1) : udt;
  const label = ((): string => {
    switch (scalar) {
      case "text":
      case "varchar":
      case "bpchar":
      case "uuid":
        return "text";
      case "date":
        return "date (`YYYY-MM-DD`)";
      case "timestamptz":
      case "timestamp":
        return "timestamp (ISO 8601)";
      case "int2":
      case "int4":
      case "int8":
        return "integer";
      case "float4":
      case "float8":
      case "numeric":
        return "number";
      case "bool":
        return "boolean";
      case "jsonb":
      case "json":
        return "object (JSON)";
      case "geography":
      case "geometry":
        return "geometry (GeoJSON)";
      default:
        return scalar;
    }
  })();
  return isArray ? `list of ${label}` : label;
}

type FieldRow = {
  field: string;
  type: string;
  required: string;
  constraints: string;
  relationship: string;
};

function typeConstraint(table: IntrospectedTable, columnName: string): string {
  const column = table.columns.find((candidate) => candidate.name === columnName);
  const udt = (column?.udtName ?? "text").replace(/^_/, "");
  if (udt === "date") return "format `YYYY-MM-DD`";
  if (udt === "timestamptz" || udt === "timestamp") return "ISO 8601";
  return "";
}

function classifyTable(recordKind: string, table: IntrospectedTable): FieldRow[] {
  const identity = identityColumn(recordKind);
  const fkByColumn = new Map(
    table.foreignKeys.map((fk) => [fk.column, fk.targetTable]),
  );
  const rows: FieldRow[] = [];
  for (const column of table.columns) {
    if (DB_MANAGED.has(column.name)) continue;
    // A source can neither know nor provide these; omit them from the request.
    if (INTAKE_COMPUTED.has(column.name)) continue;
    const type = fieldType(table, column.name);
    const constraintParts: string[] = [];
    if (table.enums.has(column.name)) {
      constraintParts.push(
        `one of ${table.enums.get(column.name)!.map((v) => `\`${v}\``).join(", ")}`,
      );
    }
    if (table.nonBlankColumns.has(column.name)) {
      constraintParts.push("non-empty");
    }
    const formatConstraint = typeConstraint(table, column.name);
    if (formatConstraint !== "") constraintParts.push(formatConstraint);

    if (column.name === identity) {
      rows.push({
        field: column.name,
        type,
        required: "yes",
        constraints: ["unique within your export; stable across exports"]
          .concat(constraintParts)
          .join("; "),
        relationship: "A stable id you assign to this record and reuse next time.",
      });
      continue;
    }
    const fkTarget = fkByColumn.get(column.name);
    if (fkTarget !== undefined) {
      const targetKind = recordKindByTable.get(bareTable(fkTarget)) ?? bareTable(fkTarget);
      rows.push({
        field: column.name,
        type,
        required: column.nullable ? "optional" : "yes",
        constraints: constraintParts.join("; ") || "—",
        relationship: `→ **${targetKind}**: your id for the linked ${targetKind}, present in the same export.`,
      });
      continue;
    }
    const required = PROVIDER_OPTIONAL.has(column.name)
      ? "optional"
      : SPEC_REQUIRED.has(`${recordKind}.${column.name}`)
        ? "yes"
        : column.nullable
          ? "optional"
          : "yes";
    rows.push({
      field: column.name,
      type,
      required,
      constraints: constraintParts.join("; ") || "—",
      relationship: "—",
    });
  }
  return rows;
}

function renderTable(rows: FieldRow[]): string {
  const header =
    "| Field | Type | Required | Constraints | Relationship / notes |\n|---|---|---|---|---|";
  const body = rows
    .map(
      (row) =>
        `| \`${row.field}\` | ${row.type} | ${row.required} | ${row.constraints} | ${row.relationship} |`,
    )
    .join("\n");
  return `${header}\n${body}`;
}

/**
 * A human-facing Markdown description of the data intake accepts, generated from
 * the live database schema so it never drifts. Per entity it lists the minimum
 * fields a source export must carry, which fields are references to other
 * records, and which intake resolves on its own.
 */
export function generateDataRequestDoc(schema: IntrospectedSchema): string {
  const sections: string[] = [];
  for (const artifactKind of IMPORT_ARTIFACT_KINDS) {
    const meta = importTypeMetadata[artifactKind];
    if (meta.targetTable === undefined) continue;
    if (OMITTED_KINDS.has(meta.recordKind)) continue;
    const table = schema.tables.get(bareTable(meta.targetTable));
    if (table === undefined) continue;
    const rows = classifyTable(meta.recordKind, table);
    sections.push(
      `### ${meta.recordKind}\n\n` +
        `Table \`${meta.targetTable}\`. One row per ${meta.recordKind}.\n\n` +
        renderTable(rows),
    );
  }

  return `<!-- Generated by \`npm run generate:data-request-doc\` from the live database schema. Do not edit by hand. -->

# Intake Data Format

This document defines the data PoliceConduct.US can accept from a source export,
generated directly from our database schema so it never drifts. Use it when
preparing a data export or when requesting one from an agency or records office.

## File naming and layout

- **One file per record type.** Name each file \`<request-id>.<Kind>.csv\`, where
  \`<request-id>\` identifies this export (any short label you choose, e.g.
  \`az-post-2026-06\`) and \`<Kind>\` is the record type from the sections below,
  spelled exactly (e.g. \`az-post-2026-06.Agency.csv\`,
  \`az-post-2026-06.AgencyPersonnel.csv\`, \`az-post-2026-06.Personnel.csv\`).
- **CSV**, UTF-8, with a **header row** of field names, one record per row.
  (If CSV is impractical, talk to us — the field definitions are the same in any
  tabular or JSON form.)
- Use the **same \`<request-id>\`** across all files in one export so we can link
  references between them.

## How to read this

For each kind of record we ingest, the table below lists its fields — with the
type, whether it is required, its constraints, and any relationship to another
record:

- **Required \`yes\`** — your export must include this field for every row.
- **\`optional\`** — include it when you have it; omit it otherwise.
- **Constraints** — an allowed value set, a non-empty requirement, or a date/time
  format the field must follow.
- **Relationship** — when a field points at another record (a foreign key), it
  names the record type it links to.

### Ids and references

- Every record needs **your own id** (the \`id\` field): any string that is unique
  within your export and that you keep the same for the same record in future
  exports.
- A **reference** field (e.g. \`agency_id\`, \`officer_id\`) is the \`id\` you gave the
  linked record elsewhere in the same export — so a record you reference must
  also be included in that export.

### These are the MINIMUM — send us more

The fields below are the least we need. **You can, and should, include any other
fields your source has** — the more context the better. Put every field that is
**not defined below** under a source-specific prefix so we can tell your fields
from ours: prefix the field name with **\`x-\`** (e.g. \`x-rank\`, \`x-badge_issued_on\`,
\`x-orig_agency_code\`). We preserve \`x-\` fields with the record; we never require
them, and we never guess their meaning.

## Record types

${sections.join("\n\n")}
`;
}
