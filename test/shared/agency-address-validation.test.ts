import { expect, test } from "vitest";
import { AgencySpec } from "../../src/shared/io/index.js";
import { correctionPropertySchema } from "../../src/shared/io/property-corrections.js";
import { DatabaseMutations } from "../../src/cli/import/artifacts/io/DatabaseMutations.js";

const metadata = { name: "agency", namespace: "org.policeconduct.manual" };
const agency = {
  id: "agency",
  name: "Agency",
  state: "MA",
  city: "Boston",
  address: "1 Main Street",
  zip_code: "02108",
  slug: "agency",
  location_path_id: "place",
  latitude: 42.36,
  longitude: -71.06,
};

function create(spec: Record<string, unknown>) {
  return DatabaseMutations.new({
    metadata,
    spec: { mutations: [{ kind: "AgencyCreate", name: "agency", spec }] },
  });
}

function update(field: string, value: unknown) {
  return DatabaseMutations.new({
    metadata,
    spec: {
      mutations: [
        {
          kind: "AgencyUpdate",
          name: "agency",
          spec: {
            operations: [
              {
                action: "set",
                path: field,
                from: undefined,
                to: value,
                reason: "Correct agency address",
                source: {
                  namespace: metadata.namespace,
                  command: { name: "correct" },
                  kind: "Agency",
                  name: "agency",
                },
              },
            ],
          },
        },
      ],
    },
  });
}

const boundaries = {
  artifact: (field: string, value: unknown) =>
    AgencySpec.parse({ ...agency, [field]: value }),
  create: (field: string, value: unknown) =>
    create({ ...agency, [field]: value }),
  update: (field: string, value: unknown) => update(field, value),
  correction: (field: string, value: unknown) =>
    correctionPropertySchema("Agency", field).parse(value),
};

test.each(Object.entries(boundaries))(
  "%s rejects approved city and address placeholders after trim and case folding",
  (_name, parse) => {
    for (const field of ["city", "address"]) {
      for (const value of [
        "NULL",
        "0",
        "x",
        "xx",
        "-----",
        "N/A",
        "test",
        "  nUlL  ",
        " X ",
        " xX ",
        " TeSt ",
        " n/a ",
      ]) {
        expect(() => parse(field, value), `${field}: ${value}`).toThrow();
      }
    }
  },
);

test.each(Object.entries(boundaries))(
  "%s rejects malformed ZIPs and all-zero five-digit ZIPs",
  (_name, parse) => {
    for (const value of [
      "0",
      "00000",
      "00000-0000",
      "00000-1234",
      "1234",
      "123456",
      "12345-123",
      "12345-12345",
      "12345 1234",
      "abcde",
    ]) {
      expect(() => parse("zip_code", value), value).toThrow();
    }
  },
);

test.each(Object.entries(boundaries))(
  "%s preserves valid leading-zero ZIPs, ZIP+4, and unapproved ambiguous addresses",
  (_name, parse) => {
    for (const value of ["02108", "00501", "02108-0000", " 02108-1234 "]) {
      expect(() => parse("zip_code", value), value).not.toThrow();
    }
    for (const value of ["341", "rere", "12t", "Test Street", "XX Road"]) {
      expect(() => parse("address", value), value).not.toThrow();
    }
  },
);

test("artifact address fields remain optional while create address fields remain required", () => {
  expect(AgencySpec.safeParse({ name: "Agency", state: "MA" }).success).toBe(
    true,
  );
  for (const field of ["city", "address", "zip_code"]) {
    const withoutField: Record<string, unknown> = { ...agency };
    delete withoutField[field];
    expect(() => create(withoutField), field).toThrow();
    expect(
      () => AgencySpec.parse({ ...agency, [field]: null }),
      field,
    ).toThrow();
  }
});

test("placeholder validation does not tighten unrelated Agency text fields", () => {
  expect(
    AgencySpec.parse({ ...agency, name: "test", contact_name: "NULL" }),
  ).toMatchObject({ name: "test", contact_name: "NULL" });
});
