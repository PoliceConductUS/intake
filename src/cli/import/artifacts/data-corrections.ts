import type { ArtifactsEnvelope } from "../../../shared/io/index.js";

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

// Declarative corrections for SYSTEMATIC source-feed errors a source keeps
// emitting. Applied by the artifacts reader delegate on every read, so a corrected
// value flows through resolution wherever the artifacts are read. (A one-off
// manual fix uses an ADR 0012 command-local mutation instead.)
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

// The corrected spec for one record of a kind (a copy; unmatched specs pass
// through unchanged).
export function correctSpec(
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

function isRecord(value: unknown): value is { spec: Record<string, unknown> } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { spec?: unknown }).spec === "object" &&
    (value as { spec?: unknown }).spec !== null
  );
}

// Apply every matching correction rule to an Artifacts envelope in place, so the
// read value is corrected. Ref (streamed) records carry no inline spec and are
// left untouched.
export function applyCorrections(artifacts: ArtifactsEnvelope): void {
  if (CORRECTION_RULES.length === 0) return;
  const kinds = new Set(CORRECTION_RULES.map((rule) => rule.kind));
  for (const artifact of artifacts.spec.artifacts) {
    if (!kinds.has(artifact.kind)) continue;
    const records = artifact.spec.records as Record<string, unknown>;
    for (const [key, record] of Object.entries(records)) {
      if (!isRecord(record)) continue;
      records[key] = {
        ...record,
        spec: correctSpec(artifact.kind, record.spec),
      };
    }
  }
}
