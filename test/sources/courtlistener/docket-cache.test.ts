import { describe, it, expect } from "vitest";
import {
  agencyNeedsSearch,
  REFRESH_DAYS,
} from "../../../sources/courtlistener/docket-cache.js";

const NOW = Date.parse("2026-06-01T00:00:00Z");
const day = 86_400_000;

describe("agencyNeedsSearch", () => {
  it("is true when the agency was never searched", () => {
    expect(agencyNeedsSearch(undefined, NOW)).toBe(true);
  });

  it("is false within the refresh window and true past it", () => {
    const recent = {
      lastSearchedAt: new Date(NOW - 10 * day).toISOString(),
      dockets: [],
    };
    const old = {
      lastSearchedAt: new Date(NOW - (REFRESH_DAYS + 1) * day).toISOString(),
      dockets: [],
    };
    expect(agencyNeedsSearch(recent, NOW)).toBe(false);
    expect(agencyNeedsSearch(old, NOW)).toBe(true);
  });

  it("is true when the stored timestamp is unparseable", () => {
    expect(
      agencyNeedsSearch({ lastSearchedAt: "nope", dockets: [] }, NOW),
    ).toBe(true);
  });
});
