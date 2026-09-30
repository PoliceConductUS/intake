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
export function cleanSourceValues(
  kind: string,
  input: Record<string, unknown>,
): { spec: Record<string, unknown>; defects: SourceValueDefect[] } {
  let spec = input;
  const defects: SourceValueDefect[] = [];
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
    });
  }
  return { spec, defects };
}
