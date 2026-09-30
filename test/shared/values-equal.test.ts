import { describe, it, expect } from "vitest";
import { valuesEqual } from "../../src/shared/values-equal.js";

describe("valuesEqual", () => {
  it("compares primitives like Object.is", () => {
    expect(valuesEqual(1, 1)).toBe(true);
    expect(valuesEqual("a", "a")).toBe(true);
    expect(valuesEqual(null, null)).toBe(true);
    expect(valuesEqual(1, 2)).toBe(false);
    expect(valuesEqual(null, undefined)).toBe(false);
    expect(valuesEqual("1", 1)).toBe(false);
  });

  it("compares jsonb objects by value, independent of key order", () => {
    expect(valuesEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(
      true,
    );
    expect(valuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
    // The failing case that broke re-import: two structurally-equal breakdowns.
    const breakdowns = { by_year: { "2020": 3, "2021": 5 } };
    expect(
      valuesEqual(breakdowns, JSON.parse(JSON.stringify(breakdowns))),
    ).toBe(true);
  });

  it("compares arrays by value and distinguishes objects from arrays", () => {
    expect(valuesEqual([1, { a: 2 }], [1, { a: 2 }])).toBe(true);
    expect(valuesEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(valuesEqual({ 0: 1 }, [1])).toBe(false);
  });
});
