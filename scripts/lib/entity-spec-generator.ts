import type {
  IntrospectedSchema,
  IntrospectedTable,
} from "./schema-introspection.js";

// Columns every entity spec omits — the database manages them, the source never
// supplies them.
const ALWAYS_EXCLUDED = new Set(["created_at", "updated_at"]);

/**
 * Per-entity nuance that is NOT derivable from the schema. Everything else —
 * which fields exist, their types, nullability, non-blank, enums — comes from
 * introspection and is asserted against it, so a column the spec claims that the
 * database lacks (or a column the database has that the spec omits) fails
 * generation.
 */
type EntityDescriptor = {
  recordKind: string;
  /** Bare table name. */
  table: string;
  /**
   * Fields optional in the base spec but required in the *Create spec — minted
   * or resolved during import rather than supplied by the source (id, slug,
   * resolved location/coordinates).
   */
  createRequired?: string[];
  /** Database column → spec field name (e.g. `boundary` → `geometry`). */
  rename?: Record<string, string>;
  /** Spec field → literal zod expression, replacing the generated one. */
  override?: Record<string, string>;
  /** Envelope-only spec fields (not columns) → literal zod expression. */
  extras?: Record<string, string>;
  /** Code appended after `.strict()` (e.g. a cross-field superRefine). */
  superRefine?: string;
  /**
   * Whether nullable fields are also `.optional()` (may be omitted). Default
   * true — sources omit absent nullable fields. Set false (strict, present-but-
   * nullable) for entities whose source always supplies every column.
   */
  optionalNullable?: boolean;
};

const LEVEL_SUPERREFINE = `.superRefine((row, context) => {
    if (row.level === "state") {
      for (const fieldName of [
        "administrative_area_slug",
        "place_slug",
        "administrative_area_name",
        "place_name",
        "parent_location_path_id",
      ] as const) {
        if (row[fieldName] !== null && row[fieldName] !== undefined) {
          context.addIssue({
            code: "custom",
            path: [fieldName],
            message: "must be null for state location paths",
          });
        }
      }
    }

    if (row.level === "administrative_area") {
      for (const fieldName of [
        "administrative_area_slug",
        "administrative_area_name",
        "parent_location_path_id",
      ] as const) {
        if (row[fieldName] === null || row[fieldName] === undefined) {
          context.addIssue({
            code: "custom",
            path: [fieldName],
            message: "is required for administrative area location paths",
          });
        }
      }
      for (const fieldName of ["place_slug", "place_name"] as const) {
        if (row[fieldName] !== null && row[fieldName] !== undefined) {
          context.addIssue({
            code: "custom",
            path: [fieldName],
            message: "must be null for administrative area location paths",
          });
        }
      }
    }

    if (row.level === "place") {
      for (const fieldName of [
        "administrative_area_slug",
        "place_slug",
        "administrative_area_name",
        "place_name",
        "parent_location_path_id",
      ] as const) {
        if (row[fieldName] === null || row[fieldName] === undefined) {
          context.addIssue({
            code: "custom",
            path: [fieldName],
            message: "is required for place location paths",
          });
        }
      }
    }
  })`;

const DESCRIPTORS: EntityDescriptor[] = [
  {
    recordKind: "LocationPath",
    table: "location_path",
    // Census supplies every column (null or value), so nullable fields are
    // present-but-nullable keys, not optional.
    optionalNullable: false,
    override: {
      centroid: "LocationPathCentroidSpec.nullable().optional()",
      bbox: "LocationPathBboxSpec.nullable().optional()",
    },
    superRefine: LEVEL_SUPERREFINE,
  },
  {
    recordKind: "LocationPathGeometry",
    table: "location_path_geometry",
    rename: { boundary: "geometry" },
    override: { geometry: "z.unknown()" },
    extras: {
      sourceLocationPathKey: "nonEmptyString",
      selectedYear: "z.union([z.string(), z.number()]).optional()",
    },
  },
  {
    recordKind: "LocationPathAlias",
    table: "location_path_alias",
    extras: {
      selectedYear: "z.union([z.string(), z.number()]).optional()",
    },
  },
  {
    recordKind: "Agency",
    table: "agency",
    createRequired: ["id", "slug", "location_path_id", "latitude", "longitude"],
    // Envelope-only geocoding hint consumed during resolution (administrative-
    // area name/slug); not a column of public.agency.
    extras: {
      location: "z.record(z.string(), z.unknown()).optional()",
    },
  },
  {
    recordKind: "Personnel",
    table: "officers",
    createRequired: ["id", "slug"],
  },
  {
    recordKind: "AgencyPersonnel",
    table: "agency_officers",
    createRequired: ["id"],
  },
  {
    recordKind: "LicensingAuthority",
    table: "licensing_authority",
    createRequired: ["id"],
  },
  { recordKind: "License", table: "license", createRequired: ["id"] },
  {
    recordKind: "LicenseAction",
    table: "license_action",
    createRequired: ["id"],
  },
];

/**
 * The entity record kinds in database-dependency order — a topological sort of
 * the introspected foreign-key graph, so a referenced entity precedes its
 * referrer. This is computed at generation time from the database's own FKs (no
 * hand-declared dependency list) and emitted as a hardcoded constant.
 */
function dependencyOrderedRecordKinds(schema: IntrospectedSchema): string[] {
  const recordKindByTable = new Map(
    DESCRIPTORS.map((descriptor) => [descriptor.table, descriptor.recordKind]),
  );
  const ordered: string[] = [];
  const done = new Set<string>();
  const onStack = new Set<string>();
  const visit = (recordKind: string, table: string): void => {
    if (done.has(recordKind)) {
      return;
    }
    if (onStack.has(recordKind)) {
      throw new Error(
        `Cyclic foreign-key dependency involving ${recordKind}; the FK graph must be a DAG.`,
      );
    }
    onStack.add(recordKind);
    const introspected = schema.tables.get(table);
    for (const referencedTable of introspected?.references ?? []) {
      const referencedKind = recordKindByTable.get(referencedTable);
      if (referencedKind !== undefined && referencedKind !== recordKind) {
        visit(referencedKind, referencedTable);
      }
    }
    onStack.delete(recordKind);
    done.add(recordKind);
    ordered.push(recordKind);
  };
  for (const descriptor of DESCRIPTORS) {
    visit(descriptor.recordKind, descriptor.table);
  }
  return ordered;
}

/**
 * Each record kind's foreign keys to other entity kinds, as
 * `{ field, targetKind }` (from the introspected FK columns). Drives the
 * exclusion cascade: a record whose FK field holds an excluded record's key is
 * itself dropped. Foreign keys to non-entity tables are omitted.
 */
function foreignKeyReferences(
  schema: IntrospectedSchema,
): Record<string, Array<{ field: string; targetKind: string }>> {
  const recordKindByTable = new Map(
    DESCRIPTORS.map((descriptor) => [descriptor.table, descriptor.recordKind]),
  );
  const references: Record<
    string,
    Array<{ field: string; targetKind: string }>
  > = {};
  for (const descriptor of DESCRIPTORS) {
    const table = schema.tables.get(descriptor.table);
    const kindReferences = (table?.foreignKeys ?? [])
      .map((fk) => ({
        field: fk.column,
        targetKind: recordKindByTable.get(fk.targetTable),
      }))
      .filter(
        (ref): ref is { field: string; targetKind: string } =>
          ref.targetKind !== undefined,
      );
    if (kindReferences.length > 0) {
      references[descriptor.recordKind] = kindReferences;
    }
  }
  return references;
}

type Column = IntrospectedTable["columns"][number];

/** The base zod type for a column, from its database type + non-blank/enum. */
function baseType(column: Column, table: IntrospectedTable): string {
  const enumValues = table.enums.get(column.name);
  if (enumValues !== undefined) {
    return `z.enum([${enumValues.map((v) => JSON.stringify(v)).join(", ")}])`;
  }
  const nonBlank = table.nonBlankColumns.has(column.name);
  switch (column.udtName) {
    case "text":
    case "varchar":
    case "bpchar":
      return nonBlank ? "nonEmptyString" : "z.string()";
    // Dates travel as ISO strings in the envelope; a date value is never blank.
    case "date":
    case "timestamptz":
    case "timestamp":
      return "nonEmptyString";
    case "float8":
    case "float4":
    case "numeric":
      return "z.number().finite()";
    case "int2":
    case "int4":
    case "int8":
      return "z.number().int()";
    case "bool":
      return "z.boolean()";
    case "jsonb":
    case "json":
      return "z.record(z.string(), z.unknown())";
    default:
      throw new Error(
        `No zod mapping for ${table.table}.${column.name} of type ${column.udtName}; add an override to its descriptor.`,
      );
  }
}

function renderEntity(
  descriptor: EntityDescriptor,
  table: IntrospectedTable,
): string {
  const rename = descriptor.rename ?? {};
  const override = descriptor.override ?? {};
  const extras = descriptor.extras ?? {};
  const createRequired = new Set(descriptor.createRequired ?? []);
  const columnNames = new Set(table.columns.map((column) => column.name));

  // Assert the descriptor only references real columns / declared fields.
  for (const source of Object.keys(rename)) {
    if (!columnNames.has(source)) {
      throw new Error(
        `${descriptor.recordKind}: rename source '${source}' is not a column of public.${table.table}.`,
      );
    }
  }
  const specFieldNames = new Set<string>([
    ...table.columns
      .filter((column) => !ALWAYS_EXCLUDED.has(column.name))
      .map((column) => rename[column.name] ?? column.name),
    ...Object.keys(extras),
  ]);
  for (const overridden of Object.keys(override)) {
    if (!specFieldNames.has(overridden)) {
      throw new Error(
        `${descriptor.recordKind}: override '${overridden}' matches no generated field.`,
      );
    }
  }
  for (const required of createRequired) {
    if (!specFieldNames.has(required)) {
      throw new Error(
        `${descriptor.recordKind}: createRequired '${required}' matches no field.`,
      );
    }
  }

  const baseFields: string[] = [];
  for (const column of table.columns) {
    if (ALWAYS_EXCLUDED.has(column.name)) {
      continue;
    }
    const fieldName = rename[column.name] ?? column.name;
    if (override[fieldName] !== undefined) {
      baseFields.push(`    ${fieldName}: ${override[fieldName]},`);
      continue;
    }
    let expression = baseType(column, table);
    if (createRequired.has(fieldName)) {
      // Optional in the base spec (resolved/minted later), required in *Create.
      expression = `${expression}.optional()`;
    } else if (column.nullable) {
      const optionalSuffix =
        descriptor.optionalNullable === false ? "" : ".optional()";
      expression =
        expression === "nonEmptyString"
          ? `nullableNonEmptyString${optionalSuffix}`
          : `${expression}.nullable()${optionalSuffix}`;
    }
    baseFields.push(`    ${fieldName}: ${expression},`);
  }
  for (const [name, expression] of Object.entries(extras)) {
    baseFields.push(`    ${name}: ${expression},`);
  }

  const specName = `${descriptor.recordKind}Spec`;
  const base = `export const ${specName} = z
  .object({
${baseFields.join("\n")}
  })
  .strict()${descriptor.superRefine ?? ""};`;

  // *Create spec: re-require the resolved/minted fields.
  const createName = `${descriptor.recordKind}CreateSpec`;
  if (createRequired.size === 0) {
    return `${base}\n\nexport const ${createName} = ${specName};`;
  }
  const createExtends = [...createRequired]
    .map((fieldName) => {
      const column = table.columns.find(
        (candidate) => (rename[candidate.name] ?? candidate.name) === fieldName,
      );
      const type =
        override[fieldName] ??
        (column === undefined ? "z.string()" : baseType(column, table));
      return `  ${fieldName}: ${type},`;
    })
    .join("\n");
  return `${base}

export const ${createName} = ${specName}.extend({
${createExtends}
});`;
}

/**
 * Renders `generated/entity-specs.ts` from the introspected schema. Column-backed
 * fields are generated and asserted against the database; descriptors add only
 * the non-schema nuance. The applied-migration fingerprint is embedded so the
 * runtime can refuse to run stale specs.
 */
export function generateEntitySpecsModule(
  schema: IntrospectedSchema,
  header: string,
): string {
  const preamble = `${header}import { z } from "zod";

// Fingerprint of the applied database migrations these specs were generated
// against. The importer refuses to run when the live database's migrations
// differ (see assertGeneratedSchemaCurrent).
export const GENERATED_MIGRATION_VERSIONS = ${JSON.stringify(
    schema.migrations.versions,
  )} as const;
export const GENERATED_MIGRATION_FINGERPRINT = ${JSON.stringify(
    schema.migrations.fingerprint,
  )};

// Entity record kinds in database-dependency order (topological sort of the
// foreign-key graph): a referenced entity precedes its referrer, so mutations
// emitted/applied in this order never violate a foreign key.
export const RECORD_KINDS_IN_DEPENDENCY_ORDER = ${JSON.stringify(
    dependencyOrderedRecordKinds(schema),
  )} as const;

// Each record kind's foreign keys to other entity kinds (field → target kind),
// from the database's own FKs. Drives the exclusion cascade: a record whose FK
// field holds an excluded record's key is dropped too.
export const FK_REFERENCES: Record<
  string,
  ReadonlyArray<{ field: string; targetKind: string }>
> = ${JSON.stringify(foreignKeyReferences(schema))};

const nonEmptyString = z.string().trim().min(1);
const nullableNonEmptyString = nonEmptyString.nullable();

const LocationPathCentroidSpec = z
  .object({
    type: z.literal("Point"),
    coordinates: z.tuple([
      z.coerce.number().finite(),
      z.coerce.number().finite(),
    ]),
  })
  .strict();

const LocationPathBboxSpec = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.tuple([
      z.tuple([
        z.tuple([z.coerce.number().finite(), z.coerce.number().finite()]),
        z.tuple([z.coerce.number().finite(), z.coerce.number().finite()]),
        z.tuple([z.coerce.number().finite(), z.coerce.number().finite()]),
        z.tuple([z.coerce.number().finite(), z.coerce.number().finite()]),
        z.tuple([z.coerce.number().finite(), z.coerce.number().finite()]),
      ]),
    ]),
  })
  .strict()
  .superRefine((bbox, context) => {
    const ring = bbox.coordinates[0];
    const [firstLng, firstLat] = ring[0];
    const [lastLng, lastLat] = ring[4];
    if (firstLng !== lastLng || firstLat !== lastLat) {
      context.addIssue({
        code: "custom",
        path: ["coordinates", 0, 4],
        message: "must close the polygon ring",
      });
    }
  });
`;

  const entities = DESCRIPTORS.map((descriptor) => {
    const table = schema.tables.get(descriptor.table);
    if (table === undefined) {
      throw new Error(
        `Descriptor references public.${descriptor.table}, which was not introspected.`,
      );
    }
    return renderEntity(descriptor, table);
  });

  return `${preamble}\n${entities.join("\n\n")}\n`;
}

/** Schema-qualified tables the generator introspects, in dependency order. */
export const ENTITY_TABLES = DESCRIPTORS.map(
  (descriptor) => `public.${descriptor.table}`,
);
