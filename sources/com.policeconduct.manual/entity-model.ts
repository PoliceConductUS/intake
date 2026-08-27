import { z } from "zod";
import * as entitySpecs from "../../src/shared/io/generated/entity-specs.js";
import { FK_REFERENCES } from "../../src/shared/io/generated/entity-specs.js";
import { identityColumnForKind } from "../../src/cli/import/artifacts/facades/resolver-registry.js";

// A field the interview prompts for, from the shared record model: whether it may
// be omitted, and — for a foreign key — the kind whose source id it holds.
export type ManualField = {
  name: string;
  optional: boolean;
  targetKind?: string;
};

// A record kind described entirely from the shared model: its identity column
// (which keys the record) and its fields. The interview is driven by this — never
// hand-coded per kind.
export type KindModel = {
  recordKind: string;
  identity: string;
  fields: ManualField[];
};

const specs = entitySpecs as unknown as Record<string, unknown>;

/** The shared model for a record kind (`<Kind>Spec` fields + FK targets + identity). */
export function describeKind(recordKind: string): KindModel {
  const spec = specs[`${recordKind}Spec`];
  if (!(spec instanceof z.ZodObject)) {
    throw new Error(
      `com.policeconduct.manual: no shared spec for kind ${recordKind}.`,
    );
  }
  const foreignKeys = new Map(
    (FK_REFERENCES[recordKind] ?? []).map((reference) => [
      reference.field,
      reference.targetKind,
    ]),
  );
  const shape = spec.shape as Record<string, z.ZodTypeAny>;
  const fields: ManualField[] = Object.entries(shape).map(
    ([name, zodType]) => ({
      name,
      optional: zodType.isOptional(),
      targetKind: foreignKeys.get(name),
    }),
  );
  return {
    recordKind,
    identity: identityColumnForKind(recordKind),
    fields,
  };
}

/** Validate a built record against the kind's shared spec (fail loud on bad input). */
export function parseRecord(
  recordKind: string,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const spec = specs[`${recordKind}Spec`];
  if (!(spec instanceof z.ZodObject)) {
    throw new Error(
      `com.policeconduct.manual: no shared spec for kind ${recordKind}.`,
    );
  }
  return spec.parse(record) as Record<string, unknown>;
}
