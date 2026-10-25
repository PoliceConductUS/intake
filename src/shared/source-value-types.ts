import { z } from "zod";
import * as specs from "./io/generated/entity-specs.js";

import { sourceValueType, type ValueType } from "./source-field-types.js";
type Field = {
  name: string;
  type: ValueType;
  required: boolean;
  nullable: boolean;
};
export type SourceValueDefect = {
  field: string;
  value: unknown;
  required: boolean;
  reason: string;
  // Whether the value was dropped from the spec. False for a defect we record
  // but keep as evidence while blocking import, because clearing it can assert a false status --
  // see `dateRangeDefects`.
  omitted: boolean;
};

const fieldsByKind = new Map<string, Field[]>();
function fieldsFor(kind: string): Field[] {
  const cached = fieldsByKind.get(kind);
  if (cached) return cached;
  const schema = (specs as Record<string, unknown>)[`${kind}Spec`];
  if (!(schema instanceof z.ZodObject))
    throw new Error(`Unknown source record kind ${kind}`);
  const fields: Field[] = [];
  for (const [name, value] of Object.entries(schema.shape)) {
    const type = sourceValueType(name);
    if (type === undefined) continue;
    const fieldSchema = value as z.ZodType;
    fields.push({
      name,
      type,
      required: !fieldSchema.safeParse(undefined).success,
      nullable: fieldSchema.safeParse(null).success,
    });
  }
  fieldsByKind.set(kind, fields);
  return fields;
}
const email = z.email();
function validPhone(value: string): boolean {
  const main = value.trim().replace(/\s*(?:ext\.?|extension|x|#)\s*\d+$/i, "");
  if (!/^\+?[\dA-Za-z().\s/-]+$/.test(main) || !/\d/.test(main)) return false;
  const digits = main
    .replace(/[a-z]/gi, (letter) => {
      const index = [
        "abc",
        "def",
        "ghi",
        "jkl",
        "mno",
        "pqrs",
        "tuv",
        "wxyz",
      ].findIndex((group) => group.includes(letter.toLowerCase()));
      return String(index + 2);
    })
    .replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && !/^0+$/.test(digits);
}
function validUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) && url.hostname.length > 0
    );
  } catch {
    return false;
  }
}
// Longest span we will accept as one real assignment. The TCOLE 2025-02-10
// production's longest genuine completed assignment is 50.8 years and its next
// longest "assignment" is a 93.9-year row created by a mistyped END_DATE, so the
// threshold is a conservative review gate, not proof of the correct date.
export const MAX_RANGE_YEARS = 70;
const DAYS_PER_YEAR = 365.25;
const MS_PER_DAY = 86_400_000;

const asDate = (value: unknown): Date | undefined => {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/**
 * Defects in a `start_date`/`end_date` pair that no clock can resolve: an end
 * before its own start, or a span no career contains. Both mean the source's own
 * record is wrong, so they are reported at ingest rather than discovered on a
 * published page -- INS-88 shipped a live profile claiming a named jailer
 * separated in 2109, which TCOLE's production really does say.
 *
 * The value is reported but kept. `end_date is null` is the corpus's encoding
 * for *currently employed*, so dropping an impossible separation date here would
 * trade a false date for a false present-tense employment claim about a named
 * person. DataContext blocks mutation generation until the source is corrected
 * or an evidence-backed conditional correction resolves the defect.
 *
 * A future `end_date` is deliberately not a defect: a source may legitimately
 * record a scheduled separation, and whether it has happened yet is a question
 * for the build clock, not for the importer.
 */
export function dateRangeDefects(
  spec: Record<string, unknown>,
): SourceValueDefect[] {
  const start = asDate(spec.start_date);
  const end = asDate(spec.end_date);
  if (start === undefined || end === undefined) return [];
  const defect = (reason: string): SourceValueDefect[] => [
    {
      field: "end_date",
      value: spec.end_date,
      required: false,
      reason,
      omitted: false,
    },
  ];
  if (end.getTime() < start.getTime())
    return defect(
      `end_date precedes start_date ${JSON.stringify(spec.start_date)}`,
    );
  const years = (end.getTime() - start.getTime()) / MS_PER_DAY / DAYS_PER_YEAR;
  return years > MAX_RANGE_YEARS
    ? defect(
        `end_date is ${years.toFixed(1)} years after start_date ${JSON.stringify(spec.start_date)}, over the ${MAX_RANGE_YEARS}-year limit`,
      )
    : [];
}

export function cleanSourceValues(
  kind: string,
  input: Record<string, unknown>,
): { spec: Record<string, unknown>; defects: SourceValueDefect[] } {
  let spec = input;
  const defects: SourceValueDefect[] = [...dateRangeDefects(input)];
  for (const field of fieldsFor(kind)) {
    const value = input[field.name];
    if (value === undefined || (value === null && field.nullable)) continue;
    const valid =
      typeof value === "string" &&
      (field.type === "phone"
        ? validPhone(value)
        : field.type === "email"
          ? email.safeParse(value).success
          : validUrl(value));
    if (valid) continue;
    if (spec === input) spec = { ...input };
    delete spec[field.name];
    defects.push({
      field: field.name,
      value,
      required: field.required,
      reason: `invalid ${field.type} value`,
      omitted: true,
    });
  }
  return { spec, defects };
}
