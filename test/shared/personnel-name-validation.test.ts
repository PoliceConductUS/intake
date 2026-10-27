import { expect, test } from "vitest";
import { PersonnelSpec } from "../../src/shared/io/index.js";
import { correctionPropertySchema } from "../../src/shared/io/property-corrections.js";
import { DatabaseMutations } from "../../src/cli/import/artifacts/io/DatabaseMutations.js";

const person = {
  id: "person",
  slug: "person",
  first_name: "Jane",
  last_name: "Tester",
};
function mutation(
  namespace: string,
  field: string,
  value: unknown,
  from: unknown = undefined,
) {
  return DatabaseMutations.new({
    metadata: { name: "change", namespace },
    spec: {
      mutations: [
        {
          kind: "PersonnelUpdate",
          name: "person",
          spec: {
            operations: [
              {
                action: "set",
                path: field,
                from,
                to: value,
                reason: "Verified source correction",
                source: {
                  namespace,
                  command: { name: "correct" },
                  kind: "Personnel",
                  name: "person",
                },
              },
            ],
          },
        },
      ],
    },
  });
}
for (const namespace of ["gov.tx.tcole", "gov.or.dpsst", "example.future"]) {
  const boundaries = {
    artifact: (field: string, value: unknown) =>
      PersonnelSpec.parse({ ...person, [field]: value }),
    create: (field: string, value: unknown) =>
      DatabaseMutations.new({
        metadata: { name: "change", namespace },
        spec: {
          mutations: [
            {
              kind: "PersonnelCreate",
              name: "person",
              spec: { ...person, [field]: value },
            },
          ],
        },
      }),
    update: (field: string, value: unknown) =>
      mutation(namespace, field, value),
    correction: (field: string, value: unknown) =>
      correctionPropertySchema("Personnel", field).parse(value),
  };
  test.each(Object.entries(boundaries))(
    `${namespace} %s preserves source string identities`,
    (_name, parse) => {
      for (const field of ["first_name", "last_name", "middle_name"]) {
        for (const value of ["9", "111", "１２３", "---", "."])
          expect(() => parse(field, value)).not.toThrow();
      }
    },
  );
  test.each(Object.entries(boundaries))(
    `${namespace} %s preserves suffix strings without inference`,
    (_name, parse) => {
      for (const value of ["111", "N/A", "155"])
        expect(() => parse("suffix", value)).not.toThrow();
      for (const value of ["Jr.", "III", "sr", null])
        expect(() => parse("suffix", value)).not.toThrow();
    },
  );
  test.each(Object.entries(boundaries))(
    `${namespace} %s retains legitimate names`,
    (_name, parse) => {
      for (const value of [
        "Null",
        "None",
        "True",
        "False",
        "Sample",
        "Tester",
        "Officer",
        "Guest",
        "Na",
        "Test",
        "Foo",
        "李",
        "Åke",
        "O’Hara",
        "J.",
      ]) {
        for (const field of ["first_name", "middle_name", "last_name"])
          expect(() => parse(field, value)).not.toThrow();
      }
    },
  );
  test(`${namespace} permits repair while retaining invalid historical evidence`, () => {
    expect(() => mutation(namespace, "first_name", "Jane", "9")).not.toThrow();
    expect(() => mutation(namespace, "suffix", null, "111")).not.toThrow();
  });
}
