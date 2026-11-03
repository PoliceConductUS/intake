import { describe, it, expect } from "vitest";
import {
  agedOutYears,
  CHANNEL_HANDLE,
  CHANNEL_ID,
  isInWindow,
  publicationWindow,
  searchWindowForYear,
  windowFloorYear,
  WINDOW_YEARS,
  yearToSearch,
} from "../../../sources/youtube.lawandcrime/channel.js";
import type { AgencyVideoCacheEntry } from "../../../sources/lib/youtube-video-cache.js";

const RUN = new Date("2026-10-24T18:30:00.000Z");
const WINDOW = publicationWindow(RUN);

function entryWith(...years: number[]): AgencyVideoCacheEntry<never> {
  return {
    years: Object.fromEntries(
      years.map((year) => [String(year), { searchedAt: "t", videos: [] }]),
    ),
  };
}

describe("pinned channel identity", () => {
  it("names the official Law&Crime Network channel by immutable id", () => {
    expect(CHANNEL_ID).toBe("UCz8K1occVvDTYDfFo7N5EZw");
    expect(CHANNEL_HANDLE).toBe("@LawAndCrime");
  });
});

describe("publicationWindow", () => {
  it("is the five-year period ending at the run", () => {
    expect(WINDOW_YEARS).toBe(5);
    expect(WINDOW).toEqual({
      from: "2021-10-24T18:30:00.000Z",
      to: "2026-10-24T18:30:00.000Z",
    });
    expect(windowFloorYear(WINDOW)).toBe(2021);
  });

  it("rolls forward with the run clock", () => {
    const later = publicationWindow(new Date("2027-01-02T00:00:00.000Z"));
    expect(later).toEqual({
      from: "2022-01-02T00:00:00.000Z",
      to: "2027-01-02T00:00:00.000Z",
    });
    expect(windowFloorYear(later)).toBe(2022);
  });
});

describe("isInWindow", () => {
  it("includes both boundaries and excludes either side", () => {
    expect(isInWindow(WINDOW.from, WINDOW)).toBe(true);
    expect(isInWindow(WINDOW.to, WINDOW)).toBe(true);
    expect(isInWindow("2021-10-24T18:29:59.999Z", WINDOW)).toBe(false);
    expect(isInWindow("2026-10-24T18:30:00.001Z", WINDOW)).toBe(false);
  });

  it("excludes a video whose publication time is missing or unreadable", () => {
    // We cannot place it in the board's period, so it does not qualify.
    expect(isInWindow("", WINDOW)).toBe(false);
    expect(isInWindow("sometime in 2023", WINDOW)).toBe(false);
  });
});

describe("searchWindowForYear", () => {
  it("clips the floor year to the window start", () => {
    expect(searchWindowForYear(2021, WINDOW)).toEqual({
      publishedAfter: "2021-10-24T18:30:00.000Z",
      publishedBefore: "2022-01-01T00:00:00.000Z",
    });
  });

  it("clips the current year to the run instant", () => {
    expect(searchWindowForYear(2026, WINDOW)).toEqual({
      publishedAfter: "2026-01-01T00:00:00.000Z",
      publishedBefore: "2026-10-24T18:30:00.000Z",
    });
  });

  it("covers a whole year in the middle of the window", () => {
    expect(searchWindowForYear(2023, WINDOW)).toEqual({
      publishedAfter: "2023-01-01T00:00:00.000Z",
      publishedBefore: "2024-01-01T00:00:00.000Z",
    });
  });
});

describe("yearToSearch", () => {
  it("starts at the current year for an agency never searched", () => {
    expect(yearToSearch(undefined, 2021, 2026)).toBe(2026);
  });

  it("backfills the newest year not yet searched", () => {
    expect(yearToSearch(entryWith(2026, 2025), 2021, 2026)).toBe(2024);
  });

  it("re-searches the still-open current year once backfilled", () => {
    // The current year keeps gaining videos the earlier search could not see.
    const backfilled = entryWith(2026, 2025, 2024, 2023, 2022, 2021);
    expect(yearToSearch(backfilled, 2021, 2026)).toBe(2026);
  });
});

describe("agedOutYears", () => {
  it("names only the years entirely outside the window", () => {
    expect(agedOutYears(entryWith(2019, 2020, 2021, 2026), WINDOW)).toEqual([
      "2019",
      "2020",
    ]);
  });

  it("is empty while every cached year still touches the window", () => {
    expect(agedOutYears(entryWith(2021, 2026), WINDOW)).toEqual([]);
  });
});
