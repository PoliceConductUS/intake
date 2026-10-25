import { describe, it, expect } from "vitest";
import {
  isWithinWindow,
  rollingWindow,
} from "../../../sources/lib/rolling-window.js";

describe("rollingWindow", () => {
  it("is the n-year period ending at the run's clock reading", () => {
    expect(rollingWindow(new Date("2026-10-24T18:30:00Z"), 5)).toEqual({
      start: "2021-10-24T18:30:00.000Z",
      end: "2026-10-24T18:30:00.000Z",
    });
  });

  it("moves with the run, so a video ages out of it", () => {
    const earlier = rollingWindow(new Date("2026-01-01T00:00:00Z"), 5);
    const later = rollingWindow(new Date("2026-06-01T00:00:00Z"), 5);
    const video = "2021-03-01T00:00:00Z";
    expect(isWithinWindow(video, earlier)).toBe(true);
    expect(isWithinWindow(video, later)).toBe(false);
  });

  it("rejects a length that is not a positive whole number of years", () => {
    const runAt = new Date("2026-10-24T00:00:00Z");
    expect(() => rollingWindow(runAt, 0)).toThrow(/positive integer/);
    expect(() => rollingWindow(runAt, -5)).toThrow(/positive integer/);
    expect(() => rollingWindow(runAt, 1.5)).toThrow(/positive integer/);
  });
});

describe("isWithinWindow", () => {
  const window = rollingWindow(new Date("2026-10-24T00:00:00Z"), 5);

  it("includes both bounds and everything between", () => {
    expect(isWithinWindow(window.start, window)).toBe(true);
    expect(isWithinWindow("2024-01-01T00:00:00Z", window)).toBe(true);
    expect(isWithinWindow(window.end, window)).toBe(true);
  });

  it("excludes a video published before the window opens or after it ends", () => {
    expect(isWithinWindow("2021-10-23T23:59:59Z", window)).toBe(false);
    expect(isWithinWindow("2026-10-25T00:00:00Z", window)).toBe(false);
  });

  it("fails loudly on a publication time it cannot read", () => {
    expect(() => isWithinWindow("not a date", window)).toThrow(
      /publishedAt is not a timestamp/,
    );
  });
});
