// Value equality for mutation diffs. `Object.is` is right for primitives but
// wrong for jsonb columns: two structurally-equal objects are distinct references,
// so the update diff would treat every jsonb column as changed and its optimistic
// `from` check (from-object vs current-object) would never hold. Compare objects
// and arrays by value, key-order-independently (Postgres jsonb does not preserve
// key order).
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((element, index) => valuesEqual(element, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      valuesEqual(left[key], right[key]),
  );
}
