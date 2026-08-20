import type { ImportRows } from "./transform.js";
import type { ImportDatabaseSchema } from "../../database/schema.js";

function formatPlanningErrors(errors: readonly string[]): string[] {
  // Unanchored: agency-preparation errors are prefixed with the source
  // agency's key/name (`Agency <sourceKey> (<name>): ...`) so this pattern
  // is matched as a substring rather than the whole error string.
  const missingCachedLocationPath = errors.filter((error) =>
    /Cached location_path_id \S+ for public\.agency \S+ does not exist\./.test(
      error,
    ),
  );
  const otherErrors = errors.filter(
    (error) => !missingCachedLocationPath.includes(error),
  );
  if (missingCachedLocationPath.length === 0) {
    return [...errors];
  }

  const examples = missingCachedLocationPath
    .slice(0, 10)
    .map((error) => `  - ${error}`);
  return [
    ...otherErrors,
    [
      `${missingCachedLocationPath.length} cached agency location_path_id values do not exist in the current database.`,
      "This usually means the location hierarchy import has not been applied to this database, or intake state contains location_path_id cache values from a different database reset.",
      "Import or replay the current census LocationPath data first, or remove the stale location_path_id ResolvedProperty envelopes so they can be recomputed.",
      "Examples:",
      ...examples,
    ].join("\n"),
  ];
}

// Carries the prepared rows and schema so the pipeline can still emit a failed
// DatabaseMutationsDebug envelope for inspection.
export class DatabaseMutationPlanningError extends Error {
  readonly rows: ImportRows;
  readonly errors: readonly string[];
  readonly schema: ImportDatabaseSchema;

  constructor(
    rows: ImportRows,
    errors: readonly string[],
    schema: ImportDatabaseSchema,
  ) {
    super(
      [
        `Import preparation failed with ${errors.length} ${errors.length === 1 ? "error" : "errors"}:`,
        ...formatPlanningErrors(errors).map((error) => `- ${error}`),
      ].join("\n"),
    );
    this.name = "DatabaseMutationPlanningError";
    this.rows = rows;
    this.errors = errors;
    this.schema = schema;
  }
}
