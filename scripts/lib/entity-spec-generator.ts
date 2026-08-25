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
  /**
   * `extras` that are import-resolution inputs only (never written to the
   * database mutation), so they are dropped from the *Create spec while staying
   * on the record spec. Extras not listed here remain on *Create (some, like a
   * geometry's source key, are carried into the mutation).
   */
  createOmit?: string[];
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
    // selectedYear is a resolution-only hint (which census year the alias came
    // from); it is not a column, so drop it from the write mutation.
    extras: {
      selectedYear: "z.union([z.string(), z.number()]).optional()",
    },
    createOmit: ["selectedYear"],
  },
  {
    recordKind: "Agency",
    table: "agency",
    // `address`/`city`/`zip_code` join the resolved-during-import bucket: an
    // agency's street location can be supplied by the source OR resolved from the
    // property cache (a committed seed) at import, so the artifact may omit them
    // (the temporarily-absent partial model), but the *Create mutation requires
    // them — "a valid agency has a non-empty, geocodable location" is enforced at
    // mutation generation, not artifact read. `state` stays required at read: it
    // is always source-provided (never seeded), so a missing state is a source
    // defect that should fail loud immediately.
    createRequired: [
      "id",
      "slug",
      "address",
      "city",
      "zip_code",
      "location_path_id",
      "latitude",
      "longitude",
    ],
    // Envelope-only geocoding hint consumed during resolution (administrative-
    // area name/slug); not a column of public.agency, so it stays off the
    // *Create mutation (the generic builder derives columns from the CreateSpec).
    extras: {
      location: "z.record(z.string(), z.unknown()).optional()",
    },
    createOmit: ["location"],
  },
  {
    recordKind: "Personnel",
    table: "personnel",
    createRequired: ["id", "slug"],
  },
  {
    recordKind: "AgencyPersonnel",
    table: "agency_personnel",
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
  { recordKind: "Discipline", table: "discipline", createRequired: ["id"] },
  {
    recordKind: "DisciplineAgencyPersonnel",
    table: "discipline_agency_personnel",
    createRequired: ["id"],
  },
  {
    recordKind: "CoverageLink",
    table: "coverage_links",
    createRequired: ["id"],
  },
  {
    recordKind: "CoverageLinkAgencyPersonnel",
    table: "coverage_link_agency_personnel",
    createRequired: ["id"],
  },
  {
    recordKind: "AgencyPhoneNumber",
    table: "agency_phone_numbers",
    createRequired: ["id"],
  },
  {
    recordKind: "FederalAgency",
    table: "federal_agency",
    createRequired: ["id"],
  },
  {
    recordKind: "FederalAgencyBranch",
    table: "federal_agency_branch",
    createRequired: ["id"],
  },
  {
    recordKind: "CivilCase",
    table: "civil_cases",
    createRequired: ["id", "slug", "location_path_id"],
    // The source supplies a namespace-local state value in location_path_id
    // (resolved-or-fail to the canonical state path at import, ADR 0006/0015).
    override: { location_path_id: "nonEmptyString.optional()" },
  },
  {
    recordKind: "CivilCasePersonnel",
    table: "civil_case_personnel",
    // Matches the table exactly: civil_case_id + agency_personnel_id, both source
    // ids the courtlistener run already stamped (ADR 0023) — agency_personnel_id
    // resolves cross-source via the ledger, civil_case_id same-source. No
    // resolution inputs: the personnel is matched in run, not at import.
    createRequired: ["id"],
  },
  {
    recordKind: "CivilCaseLink",
    table: "civil_case_links",
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

function scalarTsType(udtName: string): string | undefined {
  switch (udtName) {
    case "text":
    case "varchar":
    case "bpchar":
    case "uuid":
    case "date":
    case "timestamptz":
    case "timestamp":
    case "time":
    case "timetz":
      return "string";
    case "float8":
    case "float4":
    case "numeric":
    case "int2":
    case "int4":
    case "int8":
      return "number";
    case "bool":
      return "boolean";
    case "jsonb":
    case "json":
    case "geography":
    case "geometry":
      return "unknown";
    default:
      return undefined;
  }
}

// The TypeScript type of a database column as it appears in a persisted row —
// present, and nullable-as-`| null` (never optional). This is the DB row, not
// the source-input spec. A `_x` udt is a Postgres array of `x`.
function columnTsType(column: Column, table: IntrospectedTable): string {
  const enumValues = table.enums.get(column.name);
  if (enumValues !== undefined) {
    return enumValues.map((value) => JSON.stringify(value)).join(" | ");
  }
  const isArray = column.udtName.startsWith("_");
  const scalar = scalarTsType(isArray ? column.udtName.slice(1) : column.udtName);
  if (scalar === undefined) {
    throw new Error(
      `No TypeScript row type for ${table.table}.${column.name} of type ${column.udtName}.`,
    );
  }
  return isArray ? `${scalar}[]` : scalar;
}

// Derived/build tables (stored as base tables) that are NOT a source of truth,
// so they get no generated ROW type. Convert to a naming convention later.
const ROW_TYPE_EXCLUDED_TABLES = new Set([
  "agency_zip_index",
  "location_path_closure",
  "build_page_payload",
]);

function pascalCase(tableName: string): string {
  return tableName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

// A `<PascalTable>Row` type for a base table: every column (actual database
// name), each present, nullable columns as `T | null`. Emitted for EVERY table
// in the schema — including tables intake does not own but the website reads —
// so no hand-coded copy of a row ever exists (ADR 0025).
function renderRowType(table: IntrospectedTable): string {
  const fields = table.columns
    .filter((column) => !ALWAYS_EXCLUDED.has(column.name))
    .map((column) => {
      const type = columnTsType(column, table);
      return `  ${column.name}: ${column.nullable ? `${type} | null` : type};`;
    });
  return `export type ${pascalCase(table.table)}Row = {\n${fields.join("\n")}\n};`;
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

  // *Create spec: the mutation carries only database columns, so drop the
  // source-record/envelope-only `extras` (resolution inputs like the defendant's
  // agency/officer name, never written as columns), then re-require the
  // resolved/minted fields.
  const createName = `${descriptor.recordKind}CreateSpec`;
  const omitKeys = descriptor.createOmit ?? [];
  for (const key of omitKeys) {
    if (extras[key] === undefined) {
      throw new Error(
        `${descriptor.recordKind}: createOmit '${key}' is not one of its extras.`,
      );
    }
  }
  const omitClause =
    omitKeys.length === 0
      ? ""
      : `.omit({ ${omitKeys.map((name) => `${name}: true`).join(", ")} })`;
  if (createRequired.size === 0) {
    return `${base}\n\nexport const ${createName} = ${specName}${omitClause};`;
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

export const ${createName} = ${specName}${omitClause}.extend({
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

// Each record kind's properties resolved during import rather than supplied by
// the source (\`createRequired\`): optional in the base spec, required in the
// *Create mutation. The facade caches every one of these except \`id\` (which the
// ledger mints) through the property cache — so a resolved field becomes
// cache-backed and seedable automatically, with no per-resolver wiring.
export const RESOLVED_PROPERTIES: Record<string, readonly string[]> = ${JSON.stringify(
    Object.fromEntries(
      DESCRIPTORS.map((descriptor) => [
        descriptor.recordKind,
        descriptor.createRequired ?? [],
      ]),
    ),
  )};

// Each record kind's schema-qualified database table.
export const TABLE_BY_KIND: Record<string, string> = ${JSON.stringify(
    Object.fromEntries(
      DESCRIPTORS.map((descriptor) => [
        descriptor.recordKind,
        `public.${descriptor.table}`,
      ]),
    ),
  )};

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

  // A ROW type for every source-of-truth base table (ADR 0025) — the 19 intake
  // entities plus the website's own data tables — so no hand-coded row shape ever
  // exists. Derived/build tables (denormalized stats, closure, page payload) are
  // not source of truth and are skipped.
  const rowTypes = [...schema.tables.values()]
    .filter((table) => !ROW_TYPE_EXCLUDED_TABLES.has(table.table))
    .sort((left, right) => left.table.localeCompare(right.table))
    .map((table) => renderRowType(table));

  return `${preamble}\n${entities.join("\n\n")}\n\n${rowTypes.join("\n\n")}\n`;
}

/** Schema-qualified tables the generator introspects, in dependency order. */
export const ENTITY_TABLES = DESCRIPTORS.map(
  (descriptor) => `public.${descriptor.table}`,
);
