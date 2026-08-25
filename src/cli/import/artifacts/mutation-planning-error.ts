import type { ImportRows } from "./transform.js";
import type { ImportDatabaseSchema } from "../../database/schema.js";

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
        ...errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
    this.name = "DatabaseMutationPlanningError";
    this.rows = rows;
    this.errors = errors;
    this.schema = schema;
  }
}
