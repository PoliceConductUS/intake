import type { EmittedRecords } from "./source-run.js";

export type CorrectionRule = {
  // The import artifact kind whose records the rule applies to (e.g. Agencies).
  kind: string;
  // Every field must match a record's current value (trimmed, case-insensitive)
  // for the rule to fire — so a correction applies only where the error is.
  when: Record<string, string>;
  // Fields to overwrite when the rule matches.
  set: Record<string, string>;
  reason: string;
};

// Pre-run corrections: applied to a source's produced records before they are
// written, for SYSTEMATIC feed errors a source keeps emitting (a one-off manual
// fix uses ADR 0012 command-local artifact mutations instead). Add a rule per
// known error.
export const CORRECTION_RULES: readonly CorrectionRule[] = [
  {
    kind: "Agencies",
    when: { state: "TX", city: "Meridan" },
    set: { city: "Meridian" },
    reason: "TCOLE city typo Meridan -> Meridian",
  },
  {
    kind: "Agencies",
    when: { state: "TX", city: "Belleville" },
    set: { city: "Bellville" },
    reason: "TCOLE city typo Belleville -> Bellville",
  },
  {
    kind: "Agencies",
    when: { state: "TX", city: "Lapryor" },
    set: { city: "La Pryor" },
    reason: "TCOLE city typo Lapryor -> La Pryor",
  },
];

function norm(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function correctSpec(
  kind: string,
  spec: Record<string, unknown>,
): Record<string, unknown> {
  let result = spec;
  for (const rule of CORRECTION_RULES) {
    if (rule.kind !== kind) continue;
    const matches = Object.entries(rule.when).every(
      ([field, value]) => norm(result[field]) === norm(value),
    );
    if (matches) result = { ...result, ...rule.set };
  }
  return result;
}

// Apply every matching correction rule to a kind's produced records, returning a
// corrected copy (the input is not mutated).
export function correctRecords(
  kind: string,
  records: EmittedRecords,
): EmittedRecords {
  if (!CORRECTION_RULES.some((rule) => rule.kind === kind)) return records;
  const corrected: EmittedRecords = {};
  for (const [key, record] of Object.entries(records)) {
    corrected[key] = {
      spec: correctSpec(kind, record.spec as Record<string, unknown>),
    };
  }
  return corrected;
}
