import { TIMESTAMP_PROPERTIES } from "./io/generated/entity-specs.js";
import { timestampWithTimezone } from "./timestamp-schema.js";

/** Normalize typed timestamps for generation, comparison, and writes; preserve raw sources. */
export function timestampValue(
  kind: string,
  field: string,
  value: unknown,
): unknown {
  if (
    value === null ||
    value === undefined ||
    !TIMESTAMP_PROPERTIES[kind]?.includes(field)
  ) {
    return value;
  }
  const text = timestampWithTimezone.parse(
    value instanceof Date ? value.toISOString() : value,
  );
  // Discard fractional digits before parsing or writing so they cannot round
  // into the next second.
  return new Date(text.replace(/\.\d+/, "").replace(/([+-]\d{2})$/, "$1:00"))
    .toISOString()
    .replace(/\.000Z$/, "Z");
}
