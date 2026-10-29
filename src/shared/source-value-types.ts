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
  rule: string;
  type: "warning" | "error";
  field: string;
  value: unknown;
  required: boolean;
  reason: string;
  // Whether the value was dropped from the spec. False for a defect we record
  // but keep as evidence while omitting the record, because clearing it can assert a false status --
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
// Existing duration threshold identifies a review concern, not proof of error.
export const MAX_RANGE_YEARS = 70;
const DAYS_PER_YEAR = 365.25;
const MS_PER_DAY = 86_400_000;

const asDate = (value: unknown): Date | undefined => {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/** Findings preserve reported values; duration concerns are warnings. */
export function dateRangeDefects(
  spec: Record<string, unknown>,
): SourceValueDefect[] {
  const start = asDate(spec.start_date);
  const end = asDate(spec.end_date);
  if (start === undefined || end === undefined) return [];
  const defect = (
    reason: string,
    rule: string,
    type: "warning" | "error",
  ): SourceValueDefect[] => [
    {
      type,
      rule,
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
      "reversed-date-range",
      "error",
    );
  const years = (end.getTime() - start.getTime()) / MS_PER_DAY / DAYS_PER_YEAR;
  return years > MAX_RANGE_YEARS
    ? defect(
        `end_date is ${years.toFixed(1)} years after start_date ${JSON.stringify(spec.start_date)}, over the ${MAX_RANGE_YEARS}-year review threshold`,
        "long-date-range",
        "warning",
      )
    : [];
}

export function cleanSourceValues(
  kind: string,
  input: Record<string, unknown>,
  validationDate: Date = new Date(),
): { spec: Record<string, unknown>; defects: SourceValueDefect[] } {
  const spec = input;
  const today = validationDate.toISOString().slice(0, 10);
  const defects: SourceValueDefect[] = [...dateRangeDefects(input)];
  for (const [field, value] of Object.entries(input)) {
    if (
      !(
        field === "date" ||
        field.startsWith("date_") ||
        field.endsWith("_date")
      )
    )
      continue;
    const date = asDate(value);
    if (date !== undefined && date.toISOString().slice(0, 10) > today) {
      defects.push({
        type: "warning",
        rule: "future-date",
        field,
        value,
        required: false,
        omitted: false,
        reason: `future date exceeds validation day ${today}`,
      });
    }
  }
  for (const field of fieldsFor(kind)) {
    const value = input[field.name];
    if (value === undefined || (value === null && field.nullable)) continue;
    const valid =
      typeof value === "string" &&
      (field.type === "phone"
        ? validPhone(value)
        : field.type === "email"
          ? value
              .split(";")
              .every((address) => email.safeParse(address.trim()).success)
          : validUrl(value));
    if (valid) continue;
    defects.push({
      type: "error",
      rule: `invalid-${field.type}`,
      field: field.name,
      value,
      required: field.required,
      reason: `invalid ${field.type} value`,
      omitted: false,
    });
  }
  return { spec, defects };
}
