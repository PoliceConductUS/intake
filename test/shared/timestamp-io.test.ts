import { expect, test } from "vitest";
import { Artifacts } from "../../src/shared/io/Artifacts.js";
import { importTypeRegistry } from "../../src/shared/io/import-types.js";
import { DatabaseMutations } from "../../src/cli/import/artifacts/io/DatabaseMutations.js";

const metadata = { name: "report", namespace: "org.policeconduct.manual" };
const operationSource = {
  namespace: metadata.namespace,
  command: { name: "generate" },
  kind: "Review",
  name: metadata.name,
};
const review = {
  id: "report",
  title: "Report title",
  slug: "report-title",
  location_path_id: "place",
  latitude: 32.8,
  longitude: -96.8,
};

const boundaries = {
  record: (incident_date: string) =>
    importTypeRegistry.Reviews.recordSchema.parse({ ...review, incident_date }),
  artifact: (incident_date: string) =>
    Artifacts.new({
      metadata,
      spec: {
        artifacts: [
          {
            kind: "Reviews",
            spec: {
              records: { report: { spec: { ...review, incident_date } } },
            },
          },
        ],
      },
    }),
  create: (incident_date: string) =>
    DatabaseMutations.new({
      metadata,
      spec: {
        mutations: [
          {
            kind: "ReviewCreate",
            name: "report",
            spec: { ...review, incident_date },
          },
        ],
      },
    }),
  updateFrom: (value: string) =>
    mutation({ action: "set", from: value, to: "2023-12-04T08:00:00Z" }),
  updateTo: (value: string) =>
    mutation({ action: "set", from: "2023-12-04T08:00:00Z", to: value }),
  updateCheck: (value: string) => mutation({ action: "check", value }),
};

function mutation(operation: Record<string, unknown>) {
  return DatabaseMutations.new({
    metadata,
    spec: {
      mutations: [
        {
          kind: "ReviewUpdate",
          name: "report",
          spec: {
            operations: [
              {
                ...operation,
                path: "incident_date",
                reason: "Update incident instant",
                source: operationSource,
              },
            ],
          },
        },
      ],
    },
  });
}

test.each(Object.entries(boundaries))(
  "%s rejects incident timestamps without an explicit timezone",
  (_name, parse) => {
    for (const value of [
      "2023-12-04",
      "2023-12-04T08:00:00",
      "2023-12-04 08:00:00.123456",
    ]) {
      expect(() => parse(value), value).toThrow();
    }
  },
);

test.each(Object.entries(boundaries))(
  "%s rejects impossible incident dates before timestamp normalization",
  (_name, parse) => {
    expect(() => parse("2023-02-29T08:00:00.9999999Z")).toThrow();
  },
);

test.each(Object.entries(boundaries))(
  "%s accepts whole seconds and zero-only fractions with an explicit timezone",
  (_name, parse) => {
    for (const value of [
      "2023-12-04T08:00:00Z",
      "2023-12-04T02:00:00.000-06:00",
      "2023-12-04 08:00:00.000000+00",
    ]) {
      expect(() => parse(value)).not.toThrow();
    }
  },
);

test.each(Object.entries(boundaries))(
  "%s accepts nonzero fractional incident timestamps for whole-second preparation",
  (_name, parse) => {
    for (const value of [
      "2023-12-04T08:00:00.1Z",
      "2023-12-04 08:00:00.000001+00",
      "2023-12-04T02:00:00.1234567-06:00",
    ]) {
      expect(() => parse(value), value).not.toThrow();
    }
  },
);

test("record validation preserves explicit timestamp text, null, omission, and prose", () => {
  const incident_date = "2023-12-04T02:00:00.9999999-06:00";
  const description = "2023-12-04T08:00:00";
  expect(
    importTypeRegistry.Reviews.recordSchema.parse({
      ...review,
      incident_date,
      description,
    }),
  ).toEqual({ ...review, incident_date, description });
  expect(
    importTypeRegistry.Reviews.recordSchema.parse({
      ...review,
      incident_date: null,
    }),
  ).toEqual({ ...review, incident_date: null });
  expect(importTypeRegistry.Reviews.recordSchema.parse(review)).toEqual(review);
});
