import { expect, test } from "vitest";
import { timestampValue } from "../../src/shared/timestamp-value.js";

test("rejects timezone-less timestamp input before host-dependent interpretation", () => {
  expect(() =>
    timestampValue("Review", "incident_date", "2023-12-04T08:00:00"),
  ).toThrow(/timezone/i);
});

test.each([
  "2023-02-29T08:00:00Z",
  "2024-02-30T08:00:00.9999999Z",
  "2024-04-31T02:00:00-06:00",
])(
  "rejects impossible calendar date %s instead of rolling it forward",
  (value) => {
    expect(() => timestampValue("Review", "incident_date", value)).toThrow(
      /calendar date/i,
    );
  },
);

test("preserves a valid leap day while truncating fractions", () => {
  expect(
    timestampValue(
      "Review",
      "incident_date",
      "2024-02-29T02:00:00.9999999-06:00",
    ),
  ).toBe("2024-02-29T08:00:00Z");
});

test("compares equivalent timestamp instants across database and source representations", () => {
  for (const value of [
    "2023-12-04T08:00:00Z",
    "2023-12-04T08:00:00.000Z",
    "2023-12-04T08:00:00.000000Z",
    "2023-12-04T08:00:00+00",
    "2023-12-04 08:00:00+00",
    "2023-12-04T02:00:00-06:00",
    new Date("2023-12-04T08:00:00Z"),
  ]) {
    expect(timestampValue("Review", "incident_date", value)).toBe(
      "2023-12-04T08:00:00Z",
    );
  }
});

test("truncates nonzero fractions before parsing without rounding to the next second", () => {
  for (const value of [
    "2023-12-04T08:00:00.1Z",
    "2023-12-04 08:00:00.000001+00",
    "2023-12-04T02:00:00.1234567-06:00",
    "2023-12-04T02:00:00.9999999-06:00",
    new Date("2023-12-04T08:00:00.100Z"),
  ]) {
    expect(timestampValue("Review", "incident_date", value)).toBe(
      "2023-12-04T08:00:00Z",
    );
  }
});

test("discards pre-epoch fractional digits without rounding across the epoch", () => {
  expect(
    timestampValue("Review", "incident_date", "1969-12-31T23:59:59.9999999Z"),
  ).toBe("1969-12-31T23:59:59Z");
});

test("leaves prose, SQL dates, omitted values, and nulls untouched", () => {
  expect(
    timestampValue("Review", "description", "2023-12-04T02:00:00-06:00"),
  ).toBe("2023-12-04T02:00:00-06:00");
  expect(timestampValue("CoverageLink", "published_at", "2023-12-04")).toBe(
    "2023-12-04",
  );
  expect(timestampValue("Review", "incident_date", undefined)).toBeUndefined();
  expect(timestampValue("Review", "incident_date", null)).toBeNull();
  expect(
    timestampValue("Review", "created_at", "2023-12-04T08:00:00.123456Z"),
  ).toBe("2023-12-04T08:00:00.123456Z");
});
