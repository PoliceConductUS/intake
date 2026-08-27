import {
  FK_REFERENCES,
  PRIMARY_KEY_BY_KIND,
} from "../../../../shared/io/generated/entity-specs.js";

// A selector is the model-walked query object of ADR 0034: for a target kind,
// each key is either a scalar column (matched by equality) or a foreign-key
// relationship (the FK column minus its `_id`), whose value is a nested selector
// for the referenced kind. It names an existing row without a canonical id, so a
// manual update is portable across workspaces/lineages (ADR 0034 §3).
export type Selector = { [field: string]: string | number | Selector };

// The rows of `kind` whose columns all equal the given values. The selector
// resolver injects this (the database read) so the walk itself stays pure.
export type SelectorRowFinder = (
  kind: string,
  columnValues: Record<string, string>,
) => Promise<Array<Record<string, unknown>>>;

function isNestedSelector(value: string | number | Selector): value is Selector {
  return typeof value === "object" && value !== null;
}

/** The relationship key a foreign-key column exposes in a selector (drop `_id`). */
function relationshipKey(fkColumn: string): string {
  return fkColumn.endsWith("_id") ? fkColumn.slice(0, -"_id".length) : fkColumn;
}

/**
 * Resolve a selector to the one existing row's canonical id (ADR 0034). Walks the
 * generated FK graph: a foreign-key relationship resolves its nested selector to
 * the target's id first, then constrains this kind's FK column to it; a scalar key
 * is an equality constraint. Resolve-or-fail at every level — zero or many matches
 * throw, never a guess, never a mint (an update targets an existing row).
 */
export async function resolveIdBySelector(
  kind: string,
  selector: Selector,
  findRows: SelectorRowFinder,
): Promise<string> {
  const relationships = new Map(
    (FK_REFERENCES[kind] ?? []).map((reference) => [
      relationshipKey(reference.field),
      reference,
    ]),
  );

  const constraints: Record<string, string> = {};
  for (const [key, value] of Object.entries(selector)) {
    const relationship = relationships.get(key);
    if (relationship !== undefined) {
      if (!isNestedSelector(value)) {
        throw new Error(
          `${kind} selector: '${key}' is a foreign key and needs a nested selector, not a value.`,
        );
      }
      constraints[relationship.field] = await resolveIdBySelector(
        relationship.targetKind,
        value,
        findRows,
      );
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

  const matches = await findRows(kind, constraints);
  if (matches.length === 0) {
    throw new Error(
      `no ${kind} matches selector ${JSON.stringify(selector)}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `selector matches ${matches.length} ${kind} rows; add fields to name exactly one: ${JSON.stringify(selector)}.`,
    );
  }
  const primaryKey = PRIMARY_KEY_BY_KIND[kind] ?? "id";
  return String(matches[0]![primaryKey]);
}
