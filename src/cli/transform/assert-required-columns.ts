/**
 * Fail loud when a tabular input is missing a column the source reads. Without
 * this, a renamed or mis-typed column name reads as "" on every row and the
 * source silently drops all of them (or silently omits a field) — declaring the
 * columns a source reads turns that into a clear failure at the read boundary.
 *
 * `available` is the header set actually present; `required` the columns the
 * source will read; `context` names the input (sheet/file) for the error.
 */
export function assertRequiredColumns(
  available: Iterable<string>,
  required: readonly string[],
  context: string,
): void {
  const present = new Set(available);
  const missing = required.filter((column) => !present.has(column));
  if (missing.length > 0) {
    throw new Error(
      `${context} is missing required column(s): ${missing.join(", ")} ` +
        `(available: ${[...present].join(", ")}).`,
    );
  }
}
