import { describe, it, expect } from "vitest";
import { correctRecords } from "../../../src/cli/run/data-corrections.js";

function city(spec: unknown): unknown {
  return (spec as { city?: unknown }).city;
}

describe("correctRecords (pre-run corrections)", () => {
  it("fixes a matching record and leaves non-matching ones untouched", () => {
    const out = correctRecords("Agencies", {
      a: { spec: { city: "Meridan", state: "TX", name: "Meridian PD" } },
      b: { spec: { city: "Dallas", state: "TX", name: "Dallas PD" } },
    });
    expect(city(out.a.spec)).toBe("Meridian");
    expect(city(out.b.spec)).toBe("Dallas");
  });

  it("fires only when every 'when' field matches (scoped by state)", () => {
    // "Belleville" is a typo only in TX; a Belleville elsewhere is left alone.
    const out = correctRecords("Agencies", {
      tx: { spec: { city: "Belleville", state: "TX" } },
      il: { spec: { city: "Belleville", state: "IL" } },
    });
    expect(city(out.tx.spec)).toBe("Bellville");
    expect(city(out.il.spec)).toBe("Belleville");
  });

  it("matches case-insensitively and does not mutate the input", () => {
    const records = { a: { spec: { city: "LAPRYOR", state: "tx" } } };
    const out = correctRecords("Agencies", records);
    expect(city(out.a.spec)).toBe("La Pryor");
    expect(city(records.a.spec)).toBe("LAPRYOR");
  });

  it("returns records of a kind with no rules unchanged", () => {
    const records = { a: { spec: { city: "Meridan", state: "TX" } } };
    expect(correctRecords("Personnel", records)).toBe(records);
  });
});
