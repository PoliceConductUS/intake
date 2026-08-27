import {
  RECORD_KINDS_IN_DEPENDENCY_ORDER,
  SELF_REFERENCES,
} from "../../../shared/io/generated/entity-specs.js";
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

// A record kind's self-referential FK column (a foreign key whose target is the
// same kind, e.g. location_path.parent_location_path_id), if any. Creates of such
// a kind must be ordered root-down so a row's own-kind parent is created first.
const SELF_FK_FIELD = new Map<string, string>(Object.entries(SELF_REFERENCES));

// Kahn's topological sort of one kind's create items over its self-FK: a create
// whose self-FK points at another create in the batch is emitted after it. The
// input is already name-sorted, so ties (siblings, roots) stay deterministic.
function orderBySelfReference(
  items: DatabaseMutationItem[],
  selfFkField: string,
): DatabaseMutationItem[] {
  const byId = new Map<string, DatabaseMutationItem>();
  for (const item of items) {
    if ("name" in item) byId.set(item.name, item);
  }
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const item of items) {
    if (!("name" in item)) continue;
    inDegree.set(item.name, inDegree.get(item.name) ?? 0);
    const parent = (item.spec as Record<string, unknown>)[selfFkField];
    if (typeof parent === "string" && parent !== item.name && byId.has(parent)) {
      inDegree.set(item.name, (inDegree.get(item.name) ?? 0) + 1);
      (children.get(parent) ?? children.set(parent, []).get(parent)!).push(
        item.name,
      );
    }
  }
  const ready = items
    .filter((item) => "name" in item && (inDegree.get(item.name) ?? 0) === 0)
    .map((item) => (item as { name: string }).name);
  const ordered: DatabaseMutationItem[] = [];
  for (let head = 0; head < ready.length; head += 1) {
    const id = ready[head]!;
    ordered.push(byId.get(id)!);
    for (const child of children.get(id) ?? []) {
      const remaining = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, remaining);
      if (remaining === 0) ready.push(child);
    }
  }
  // A cycle would leave rows unplaced; fall back to input order for those so the
  // plan is still complete (a self-FK cycle is a data error the FK will reject).
  if (ordered.length < items.length) {
    const placed = new Set(ordered);
    for (const item of items) if (!placed.has(item)) ordered.push(item);
  }
  return ordered;
}

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
 * Within a kind, order by the mutation's `name` (its identity) for a deterministic
 * plan (stable chain entries, ADR 0033). Then, for any self-referential kind (a
 * table with an FK to itself, e.g. location_path.parent_location_path_id), the
 * kind's contiguous create run is re-ordered root-down by a topological sort over
 * that self-FK, so a row's own-kind parent is always created before it and the
 * create-batcher never inserts a child before its parent on a fresh apply. This is
 * general: it derives the self-FK from `SELF_REFERENCES`, so it holds for any
 * future self-referential table, not one special-cased column.
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
  const nameKey = (item: DatabaseMutationItem): string =>
    "name" in item ? item.name : "";
  // Compute each item's sort keys once (they involve string parsing), then sort
  // by the cached values. At hundreds of thousands of rows, recomputing the keys
  // inside the comparator would parse strings tens of millions of times.
  const decorated = items.map((item) => ({
    item,
    rank: operationRank(item),
    dependency: dependencyIndex(item),
    name: nameKey(item),
  }));
  decorated.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.dependency - b.dependency ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const sorted = decorated.map((entry) => entry.item);

  // Re-order each self-referential kind's create run root-down (parents first).
  const result: DatabaseMutationItem[] = [];
  for (let start = 0; start < sorted.length; ) {
    const item = sorted[start]!;
    const selfFk =
      "kind" in item &&
      parseMutationKind(item.kind).operation === "create" &&
      SELF_FK_FIELD.get(recordKindOfMutation(item.kind));
    if (!selfFk) {
      result.push(item);
      start += 1;
      continue;
    }
    let end = start + 1;
    while (end < sorted.length) {
      const next = sorted[end]!;
      if (!("kind" in next) || next.kind !== item.kind) break;
      end += 1;
    }
    result.push(...orderBySelfReference(sorted.slice(start, end), selfFk));
    start = end;
  }
  return result;
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
