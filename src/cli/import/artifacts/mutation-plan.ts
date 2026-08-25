import { RECORD_KINDS_IN_DEPENDENCY_ORDER } from "../../../shared/io/generated/entity-specs.js";
import { IMPORT_OPERATION_SUFFIXES } from "../../../shared/io/import-type-metadata.js";
import { parseMutationKind } from "../../../shared/io/import-types.js";
import type { DatabaseMutationItem } from "./io/DatabaseMutations.js";
import type { DatabaseMutationEnvelope } from "./io/DatabaseMutation.js";

const DEPENDENCY_ORDER_INDEX = new Map<string, number>(
  RECORD_KINDS_IN_DEPENDENCY_ORDER.map((recordKind, index) => [
    recordKind,
    index,
  ]),
);

/** The record kind of a mutation kind, stripping the operation suffix. */
function recordKindOfMutation(mutationKind: string): string {
  for (const suffix of Object.values(IMPORT_OPERATION_SUFFIXES)) {
    if (mutationKind.endsWith(suffix)) {
      return mutationKind.slice(0, -suffix.length);
    }
  }
  return mutationKind;
}

/**
 * Orders mutation items by database dependency, using the generated
 * `RECORD_KINDS_IN_DEPENDENCY_ORDER` (a topological sort of the introspected
 * foreign-key graph), so a referenced entity is applied before its referrer
 * (e.g. Licenses before the AgencyPersonnel whose `license_id` targets them). A
 * stable sort preserves the within-kind order. Unknown kinds sort last.
 *
 * Order every create before any update (ADR 0020). Creates keep FK-dependency
 * order among themselves (a row's FK targets are created first); updates follow
 * all creates, so an update's FK to a row created this import already exists and
 * an update never gates a create (its own target row already existed). The
 * replay can then batch each contiguous create run and apply updates singly —
 * the first update marks the end of the creates.
 */
function sortByDependencyOrder(
  items: DatabaseMutationItem[],
): DatabaseMutationItem[] {
  const operationRank = (item: DatabaseMutationItem): number =>
    "kind" in item && parseMutationKind(item.kind).operation === "create"
      ? 0
      : 1;
  const dependencyIndex = (item: DatabaseMutationItem): number =>
    "kind" in item
      ? (DEPENDENCY_ORDER_INDEX.get(recordKindOfMutation(item.kind)) ??
        Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        operationRank(a.item) - operationRank(b.item) ||
        dependencyIndex(a.item) - dependencyIndex(b.item) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

/**
 * True when an item is an update whose operations are *all* `check` — it asserts
 * expected state but sets nothing, so it mutates nothing and is not a mutation
 * (ADR 0011/0014). These are dropped from the emitted plan so a re-import of an
 * already-matching row emits no SELECT + empty UPDATE; an update that still
 * carries a `set` keeps its sibling `check`s as per-row drift guards, and creates
 * (which have no `operations`) are never affected.
 */
function isCheckOnlyUpdateItem(item: DatabaseMutationItem): boolean {
  if (!("spec" in item)) {
    return false;
  }
  const operations = (item.spec as { operations?: unknown }).operations;
  return (
    Array.isArray(operations) &&
    operations.length > 0 &&
    operations.every(
      (operation) =>
        typeof operation === "object" &&
        operation !== null &&
        (operation as { action?: unknown }).action === "check",
    )
  );
}

/**
 * Turn the facades' emitted mutation envelopes into the ordered plan: drop
 * check-only (no-op) updates, then sort by create-before-update and FK
 * dependency. Every entity emits through its facade (ADR 0016), so this is the
 * single point the whole plan flows through.
 */
export function planDatabaseMutationItems(
  envelopes: DatabaseMutationEnvelope[],
): DatabaseMutationItem[] {
  const items: DatabaseMutationItem[] = envelopes.map((mutation) => ({
    kind: mutation.kind,
    name: mutation.metadata.name,
    spec: mutation.spec,
  }));
  return sortByDependencyOrder(
    items.filter((item) => !isCheckOnlyUpdateItem(item)),
  );
}
