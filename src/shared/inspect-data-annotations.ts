import { DATE_PROPERTIES } from "./io/generated/entity-specs.js";
import {
  DataAnnotation,
  SourceExclusions,
  type SourceValues,
} from "./data-annotations.js";
import { cleanSourceValues } from "./source-value-types.js";

export function isDateField(field: string): boolean {
  return (
    field === "date" || field.startsWith("date_") || field.endsWith("_date")
  );
}

export function representableDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/** Pure inspection of final effective values; provenance is an input, never inferred. */
export function inspectDataAnnotations(
  kind: string,
  values: Record<string, unknown>,
  sourceValues: SourceValues,
  validationDate: Date,
): DataAnnotation[] {
  const findings: DataAnnotation[] = [];
  if (kind === "LicensingAuthority" && values.source_exclusions !== undefined) {
    for (const [namespace, exclusions] of Object.entries(
      SourceExclusions.parse(values.source_exclusions),
    )) {
      for (const exclusion of exclusions)
        findings.push(
          DataAnnotation.parse({
            type: "warning",
            field: "excluded_records",
            value: {
              kind: exclusion.kind,
              key: exclusion.key,
              ...(exclusion.name === undefined ? {} : { name: exclusion.name }),
            },
            source_namespace: namespace,
            source_record_id: exclusion.key,
            message: `Explicitly excluded ${exclusion.kind}: ${exclusion.reason}`,
          }),
        );
    }
  }
  for (const [field, source] of Object.entries(sourceValues)) {
    if (
      (isDateField(field) || DATE_PROPERTIES[kind]?.includes(field)) &&
      values[field] === null &&
      source.effective_value !== null &&
      !representableDate(source.effective_value)
    ) {
      findings.push(
        DataAnnotation.parse({
          source_namespace: source.source_namespace,
          source_record_id: source.source_record_id,
          value: source.effective_value,
          field,
          type: "error",
          message: "The reported value is not a valid date.",
        }),
      );
    }
  }
  for (const defect of cleanSourceValues(kind, values, validationDate)
    .defects) {
    const source = sourceValues[defect.field];
    if (source === undefined)
      throw new Error(`Missing source evidence for ${kind}.${defect.field}.`);
    findings.push(
      DataAnnotation.parse({
        source_namespace: source.source_namespace,
        source_record_id: source.source_record_id,
        field: defect.field,
        value: defect.value,
        type: defect.type,
        message: defect.reason,
      }),
    );
  }
  return findings;
}

/** Typed null does not erase a retained, unrepresentable effective source value. */
export function reportedFieldValue(
  stored: unknown,
  evidence: SourceValues[string] | undefined,
): unknown {
  return stored === null && evidence !== undefined
    ? evidence.effective_value
    : stored;
}
