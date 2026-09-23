/** Normalize structured, single-line text; raw evidence and prose stay unchanged. */
export function normalizeTextWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
