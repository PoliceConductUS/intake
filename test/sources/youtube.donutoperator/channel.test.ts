import { describe, it, expect } from "vitest";
import {
  CHANNEL_HANDLE,
  CHANNEL_ID,
  WINDOW_YEARS,
  inWindow,
  runClock,
  windowFloorYear,
  windowStart,
} from "../../../sources/youtube.donutoperator/channel.js";

const NOW = new Date("2026-06-01T00:00:00Z");

describe("pinned channel identity", () => {
  it("pins the board-confirmed channel id and its handle", () => {
    expect(CHANNEL_ID).toBe("UCwkm_Wcyh0pc7UUmZZfL-6w");
    expect(CHANNEL_HANDLE).toBe("@DonutOperator");
  });
});

describe("rolling window", () => {
  it("opens exactly five calendar years before the run", () => {
    expect(WINDOW_YEARS).toBe(5);
    expect(windowStart(NOW).toISOString()).toBe("2021-06-01T00:00:00.000Z");
    expect(windowFloorYear(NOW)).toBe(2021);
  });

  it("includes the start edge and the run instant", () => {
    expect(inWindow("2021-06-01T00:00:00Z", NOW)).toBe(true);
    expect(inWindow("2026-06-01T00:00:00Z", NOW)).toBe(true);
  });

  it("excludes a video published one second before the window opened", () => {
    expect(inWindow("2021-05-31T23:59:59Z", NOW)).toBe(false);
  });

  it("excludes a video dated after the run", () => {
    expect(inWindow("2026-06-01T00:00:01Z", NOW)).toBe(false);
  });

  it("excludes a video whose publication time is missing or unparseable", () => {
    // Eligibility has to be shown, not assumed: an undated video cannot be shown
    // to be recent.
    expect(inWindow(undefined, NOW)).toBe(false);
    expect(inWindow(null, NOW)).toBe(false);
    expect(inWindow("", NOW)).toBe(false);
  });

  it("excludes prose a lenient Date parser would happily accept", () => {
    // `new Date("sometime in 2024")` yields a real instant inside the window, so
    // the shape is checked before parsing.
    expect(inWindow("sometime in 2024", NOW)).toBe(false);
    expect(inWindow("March 5 2024", NOW)).toBe(false);
    expect(inWindow("2024", NOW)).toBe(false);
  });

  it("accepts the RFC 3339 instants the YouTube API returns", () => {
    expect(inWindow("2024-03-05T12:00:00Z", NOW)).toBe(true);
    expect(inWindow("2024-03-05T12:00:00.123Z", NOW)).toBe(true);
    expect(inWindow("2024-03-05T12:00:00+02:00", NOW)).toBe(true);
    expect(inWindow("2024-03-05", NOW)).toBe(true);
  });

  it("excludes a well-shaped but impossible date", () => {
    expect(inWindow("2024-13-45T00:00:00Z", NOW)).toBe(false);
  });

  it("rolls forward with the run, so a video ages out without any config change", () => {
    const video = "2021-07-01T00:00:00Z";
    expect(inWindow(video, new Date("2026-06-01T00:00:00Z"))).toBe(true);
    expect(inWindow(video, new Date("2026-08-01T00:00:00Z"))).toBe(false);
  });
});

describe("runClock", () => {
  it("uses the pinned instant when one is given", () => {
    expect(
      runClock({ YOUTUBE_WINDOW_NOW: "2026-06-01T00:00:00Z" }).toISOString(),
    ).toBe("2026-06-01T00:00:00.000Z");
  });

  it("falls back to the wall clock when unset or blank", () => {
    const before = Date.now();
    expect(runClock({}).getTime()).toBeGreaterThanOrEqual(before);
    expect(
      runClock({ YOUTUBE_WINDOW_NOW: "  " }).getTime(),
    ).toBeGreaterThanOrEqual(before);
  });

  it("throws on an unparseable pin rather than changing which videos are eligible", () => {
    expect(() => runClock({ YOUTUBE_WINDOW_NOW: "not-a-date" })).toThrow(
      /not a parseable instant/,
    );
  });
});
