import {
  FK_REFERENCES,
  PRIMARY_KEY_BY_KIND,
} from "../../../../shared/io/generated/entity-specs.js";

// A selector is the model-walked query object of ADR 0034: for a target kind, each
// key is either a scalar column (matched by equality) or a foreign-key relationship
// (the FK column minus its `_id`), whose value is a nested selector for the
// referenced kind. It names an existing row without a canonical id, so a manual
// update is portable across workspaces/lineages (ADR 0034 §3).
export type Selector = { [field: string]: string | number | Selector };

// A column constraint: an exact value, or a set of candidate ids the column must be
// one of (a foreign-key hop that resolved to more than one target).
export type ColumnConstraint = string | readonly string[];

// The rows of `kind` whose columns all satisfy the given constraints (a plain value
// matches by equality; a candidate set matches by membership). The selector resolver
// injects this (the database read) so the walk itself stays pure.
export type SelectorRowFinder = (
  kind: string,
  columnConstraints: Record<string, ColumnConstraint>,
) => Promise<Array<Record<string, unknown>>>;

function isNestedSelector(value: string | number | Selector): value is Selector {
  return typeof value === "object" && value !== null;
}

/** The relationship key a foreign-key column exposes in a selector (drop `_id`). */
function relationshipKey(fkColumn: string): string {
  return fkColumn.endsWith("_id") ? fkColumn.slice(0, -"_id".length) : fkColumn;
}

/**
 * The candidate ids of every row of `kind` matching the selector. A foreign-key hop
 * resolves its nested selector to *its* candidates first, then constrains this kind's
 * FK column to that set — so an ambiguous hop (two people named Paul Lewis) is
 * disambiguated by the join at the parent (the one at this agency), not required to be
 * unique on its own. A scalar key is an equality constraint.
 */
async function resolveCandidates(
  kind: string,
  selector: Selector,
  findRows: SelectorRowFinder,
): Promise<string[]> {
  const relationships = new Map(
    (FK_REFERENCES[kind] ?? []).map((reference) => [
      relationshipKey(reference.field),
      reference,
    ]),
  );

  const constraints: Record<string, ColumnConstraint> = {};
  for (const [key, value] of Object.entries(selector)) {
    const relationship = relationships.get(key);
    if (relationship !== undefined) {
      if (!isNestedSelector(value)) {
        throw new Error(
          `${kind} selector: '${key}' is a foreign key and needs a nested selector, not a value.`,
        );
      }
      const candidates = await resolveCandidates(
        relationship.targetKind,
        value,
        findRows,
      );
      if (candidates.length === 0) {
        // No target matches, so no row of this kind can — an empty candidate set.
        return [];
      }
      constraints[relationship.field] = candidates;
    } else {
      if (isNestedSelector(value)) {
        throw new Error(
          `${kind} selector: '${key}' is a scalar column and needs a value, not a nested selector.`,
        );
      }
      constraints[key] = String(value);
    }
  }

  if (Object.keys(constraints).length === 0) {
    throw new Error(`${kind} selector is empty; it must constrain at least one field.`);
  }

  const primaryKey = PRIMARY_KEY_BY_KIND[kind] ?? "id";
  const rows = await findRows(kind, constraints);
  return rows.map((row) => String(row[primaryKey]));
}

/**
 * Resolve a selector to the one existing row's canonical id (ADR 0034), walking the
 * generated FK graph. Resolve-or-fail: the *target* row must be unique — zero or many
 * matches throw, never a guess, never a mint (an update targets an existing row).
 * Ambiguity inside a foreign-key hop is fine when the parent constraints still name
 * exactly one row.
 */
export async function resolveIdBySelector(
  kind: string,
  selector: Selector,
  findRows: SelectorRowFinder,
): Promise<string> {
  const candidates = await resolveCandidates(kind, selector, findRows);
  if (candidates.length === 0) {
    throw new Error(`no ${kind} matches selector ${JSON.stringify(selector)}.`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `selector matches ${candidates.length} ${kind} rows; add fields to name exactly one: ${JSON.stringify(selector)}.`,
    );
  }
  return candidates[0]!;
}
