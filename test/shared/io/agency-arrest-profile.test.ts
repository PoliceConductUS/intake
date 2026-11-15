import { expect, test } from "vitest";
import { AgencyArrestProfiles } from "../../../src/shared/io/index.js";
import { selectAgencyGraph } from "../../../src/cli/import/artifacts/agency-graph.js";

test("agency aggregate uses strict canonical IO and retains free-form summary JSON", () => {
  const kind = AgencyArrestProfiles;
  const input = {
    metadata: { namespace: "test", name: "profiles" },
    spec: {
      records: {
        profile: {
          metadata: { name: "profile" },
          spec: {
            id: "profile",
            agency_id: "agency",
            coverage: { bookings: 2 },
            breakdowns: { months: { "2026-01": 2 } },
          },
        },
      },
    },
  };
  expect(kind.new(input).spec.records.profile.spec.coverage).toEqual({
    bookings: 2,
  });
  expect(
    kind.schema.safeParse({
      ...input,
      apiVersion: "policeconduct.org/intake/v1alpha1",
      kind: "AgencyArrestProfiles",
      spec: { ...input.spec, unknown: true },
    }).success,
  ).toBe(false);
  expect(
    kind.schema.safeParse({
      ...input,
      apiVersion: "old",
      kind: "AgencyArrestProfiles",
    }).success,
  ).toBe(false);
  expect(
    kind.schema.safeParse({
      ...input,
      apiVersion: "policeconduct.org/intake/v1alpha1",
      kind: "Wrong",
    }).success,
  ).toBe(false);
});

test("agency selection retains its agency aggregate only", () => {
  const selected = selectAgencyGraph(
    [],
    [
      { kind: "Agency", id: "agency", values: {} },
      {
        kind: "AgencyArrestProfile",
        id: "profile",
        values: { agency_id: "agency" },
      },
      {
        kind: "AgencyArrestProfile",
        id: "other",
        values: { agency_id: "other-agency" },
      },
    ],
    ["agency"],
  );
  expect(selected.has("AgencyArrestProfile:profile")).toBe(true);
  expect(selected.has("AgencyArrestProfile:other")).toBe(false);
});
