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
 * (e.g. Licenses before the AgencyPersonnel whose `license_id` targets them).
 * Unknown kinds sort last.
 *
 * Within a kind, order by a hierarchical key: the record's `path` when it has one
 * (location_path — the only self-referential kind — is keyed on a cuid, so its
 * `name` is random; its `path` is the hierarchy), else the mutation's `name`. Byte
 * order puts a parent (`/tx/dallas-county/`) before its child
 * (`/tx/dallas-county/irving/`), since the parent's path is a prefix. So a row's
 * own-kind FK target is always created first and the create-batcher never inserts
 * a child before its parent. For kinds without a self-reference the within-kind
 * order is immaterial; this just makes the plan deterministic (stable chain
 * entries, ADR 0033).
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
  const hierarchicalKey = (item: DatabaseMutationItem): string => {
    if ("spec" in item) {
      const path = (item.spec as { path?: unknown }).path;
      if (typeof path === "string") return path;
    }
    return "name" in item ? item.name : "";
  };
  // Compute each item's sort keys once (they involve string parsing), then sort
  // by the cached values. At hundreds of thousands of rows, recomputing the keys
  // inside the comparator would parse strings tens of millions of times.
  const decorated = items.map((item) => ({
    item,
    rank: operationRank(item),
    dependency: dependencyIndex(item),
    name: hierarchicalKey(item),
  }));
  decorated.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.dependency - b.dependency ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return decorated.map((entry) => entry.item);
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
