import { SourceFieldEvidence } from "../../../src/shared/data-annotations.js";
import { expect, test } from "vitest";
import { inspectDataAnnotations } from "../../../src/shared/inspect-data-annotations.js";
const evidence = (value: unknown) =>
  SourceFieldEvidence.parse({
    value,
    effective_value: value,
    source_namespace: "test.provider",
    source_record_id: "assignment-1",
  });
const inspect = (
  values: Record<string, unknown>,
  original = values,
  day = "2026-10-27",
) =>
  inspectDataAnnotations(
    "AgencyPersonnel",
    values,
    Object.fromEntries(
      Object.entries(original).map(([field, value]) => [
        field,
        evidence(value),
      ]),
    ),
    new Date(day),
  );
test("contradictory dates are errors, long spans and future dates are warnings", () => {
  expect(inspect({ start_date: "2020-01-01", end_date: "2019-01-01" })).toEqual(
    [
      expect.objectContaining({
        type: "error",
        field: "end_date",
        value: "2019-01-01",
        source_record_id: "assignment-1",
      }),
    ],
  );
  expect(inspect({ start_date: "1900-01-01", end_date: "2025-01-01" })).toEqual(
    [expect.objectContaining({ type: "warning", field: "end_date" })],
  );
  expect(inspect({ start_date: "2027-01-01", end_date: null })).toEqual([
    expect.objectContaining({ type: "warning", field: "start_date" }),
  ]);
});
test("checks effective corrected values and clears obsolete findings", () => {
  expect(
    inspect(
      { start_date: "2020-01-01", end_date: "2025-01-01" },
      { start_date: "2020-01-01", end_date: "2019-01-01" },
    ),
  ).toEqual([]);
  expect(
    inspect({ start_date: "2027-01-01" }, undefined, "2027-01-01"),
  ).toEqual([]);
});
test("invalid literals remain inspectable when typed storage is null", () => {
  expect(inspect({ end_date: null }, { end_date: "not a date" })).toEqual([
    expect.objectContaining({ type: "error", value: "not a date" }),
  ]);
});
test("valid source end dates deliberately corrected to null are not invalid literals", () => {
  expect(inspect({ end_date: null }, { end_date: "2020-01-01" })).toEqual([]);
});
test("will not invent attribution for a detected problem", () => {
  expect(() =>
    inspectDataAnnotations(
      "AgencyPersonnel",
      { start_date: "2020-01-01", end_date: "2019-01-01" },
      {},
      new Date("2026-10-27"),
    ),
  ).toThrow(/source evidence/i);
});

test("an invalid source date explicitly corrected to null stays cleared", () => {
  expect(
    inspectDataAnnotations(
      "AgencyPersonnel",
      { end_date: null },
      { end_date: { ...evidence("invalid"), effective_value: null } },
      new Date("2026-10-27"),
    ),
  ).toEqual([]);
});

test("stored null with an unrepresentable end date is not current employment", async () => {
  const { reportedFieldValue } =
    await import("../../../src/shared/inspect-data-annotations.js");
  expect(reportedFieldValue(null, { ...evidence("invalid") })).not.toBeNull();
  expect(
    reportedFieldValue(null, { ...evidence("invalid"), effective_value: null }),
  ).toBeNull();
});

test("finding identities distinguish rules and survive changing values and validation days", async () => {
  const { inspectDataAnnotationFindings } =
    await import("../../../src/shared/inspect-data-annotations.js");
  const inspectFindings = (end: string, day: string) =>
    inspectDataAnnotationFindings(
      "AgencyPersonnel",
      { start_date: "1900-01-01", end_date: end },
      { start_date: evidence("1900-01-01"), end_date: evidence(end) },
      new Date(day),
    );
  const first = inspectFindings("2030-01-01", "2026-10-27");
  const second = inspectFindings("2031-01-01", "2026-10-28");
  expect(first).toHaveLength(2);
  expect(new Set(first.map((item) => item.key)).size).toBe(2);
  expect(second.map((item) => item.key)).toEqual(first.map((item) => item.key));
  expect(second.map((item) => item.annotation.message)).not.toEqual(
    first.map((item) => item.annotation.message),
  );
});
