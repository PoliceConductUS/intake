import type { DatabaseClient } from "./index.js";

/**
 * Reading suppression state during import planning.
 *
 * The database refuses writes to a suppressed subject outright (see
 * supabase/migrations/20260824190000_corrections_and_takedown.sql). That
 * refusal is the guarantee, but it is a backstop: if the planner did not know
 * about suppressions, every import after a takedown would abort on the first
 * suppressed row. Intake reads the same state and plans around it, so a
 * honoured takedown costs one skipped record rather than a broken pipeline.
 *
 * `intake_writer` is granted SELECT and nothing else on these tables, so this
 * read works and the corresponding write does not.
 */

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

/**
 * Canonical IDs under an active suppression, regardless of subject_type.
 *
 * Type-agnostic on purpose: canonical IDs are cuid2 and globally unique, so a
 * suppression filed against subject_type='person' must still stop a write that
 * calls the same ID an 'officer'.
 */
export async function readActiveSuppressedIds(
  client: DatabaseClient,
): Promise<ReadonlySet<string>> {
  const rows = rowsFromResult(
    await client.query(
      `select distinct subject_id
       from public.subject_suppression
       where lifted_at is null`,
    ),
  );

  return new Set(rows.map((row) => String(row.subject_id)));
}
