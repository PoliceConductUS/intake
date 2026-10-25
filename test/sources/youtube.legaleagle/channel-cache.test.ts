import { describe, it, expect } from "vitest";
import {
  isInWindow,
  lastSearchedAt,
  mergedVideos,
  nextYearToAcquire,
  rollingWindow,
  searchBounds,
  windowYearRange,
  type ChannelCacheEntry,
} from "../../../sources/lib/youtube-channel-cache.js";

function video(id: string, publishedAt = "2024-01-01T00:00:00Z") {
  return {
    videoId: id,
    title: id,
    description: "",
    publishedAt,
    channelId: "c",
    url: `https://www.youtube.com/watch?v=${id}`,
    captions: null,
    retrievedAt: "2026-10-24T00:00:00.000Z",
  };
}

const RUN_AT = new Date("2026-10-24T12:00:00.000Z");

describe("rollingWindow", () => {
  it("spans the configured years back from the run instant", () => {
    expect(rollingWindow(RUN_AT, 5)).toEqual({
      start: "2021-10-24T12:00:00.000Z",
      end: "2026-10-24T12:00:00.000Z",
    });
  });

  it("ends at the run instant, not the end of the year", () => {
    expect(rollingWindow(RUN_AT, 5).end).toBe(RUN_AT.toISOString());
  });
});

describe("windowYearRange", () => {
  it("covers the oldest and newest calendar year the window touches", () => {
    expect(windowYearRange(rollingWindow(RUN_AT, 5))).toEqual({
      floorYear: 2021,
      newestYear: 2026,
    });
  });
});

describe("searchBounds", () => {
  const window = rollingWindow(RUN_AT, 5);

  it("clips the oldest chunk to the window start", () => {
    expect(searchBounds(2021, window)).toEqual({
      publishedAfter: "2021-10-24T12:00:00.000Z",
      publishedBefore: "2022-01-01T00:00:00.000Z",
    });
  });

  it("clips the newest chunk to the run instant", () => {
    expect(searchBounds(2026, window)).toEqual({
      publishedAfter: "2026-01-01T00:00:00.000Z",
      publishedBefore: "2026-10-24T12:00:00.000Z",
    });
  });

  it("uses whole-year bounds in the middle of the window", () => {
    expect(searchBounds(2023, window)).toEqual({
      publishedAfter: "2023-01-01T00:00:00.000Z",
      publishedBefore: "2024-01-01T00:00:00.000Z",
    });
  });
});

describe("nextYearToAcquire", () => {
  it("starts at the newest year for an agency never searched", () => {
    expect(nextYearToAcquire(undefined, 2021, 2026)).toBe(2026);
  });

  it("walks back to the newest year not yet searched", () => {
    const entry: ChannelCacheEntry = {
      years: {
        "2026": { searchedAt: "t", videos: [] },
        "2025": { searchedAt: "t", videos: [] },
      },
    };
    expect(nextYearToAcquire(entry, 2021, 2026)).toBe(2024);
  });

  it("refreshes the newest year once the backfill is complete", () => {
    const years = Object.fromEntries(
      [2021, 2022, 2023, 2024, 2025, 2026].map((year) => [
        String(year),
        { searchedAt: "t", videos: [] },
      ]),
    );
    expect(nextYearToAcquire({ years }, 2021, 2026)).toBe(2026);
  });
});

describe("lastSearchedAt", () => {
  it("is empty for an agency never searched, so it sorts first", () => {
    expect(lastSearchedAt(undefined)).toBe("");
    expect("".localeCompare("2021-01-01T00:00:00.000Z")).toBeLessThan(0);
  });

  it("is the most recent chunk search time", () => {
    const entry: ChannelCacheEntry = {
      years: {
        "2025": { searchedAt: "2026-01-01T00:00:00.000Z", videos: [] },
        "2026": { searchedAt: "2026-06-01T00:00:00.000Z", videos: [] },
      },
    };
    expect(lastSearchedAt(entry)).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("mergedVideos", () => {
  it("merges every cached year and de-duplicates by videoId", () => {
    const entry: ChannelCacheEntry = {
      years: {
        "2026": { searchedAt: "t", videos: [video("a"), video("b")] },
        "2025": { searchedAt: "t", videos: [video("b"), video("c")] },
      },
    };
    expect(
      mergedVideos(entry)
        .map((v) => v.videoId)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });

  it("is empty for an unsearched agency", () => {
    expect(mergedVideos(undefined)).toEqual([]);
  });
});

describe("isInWindow", () => {
  const window = rollingWindow(RUN_AT, 5);

  it("accepts a publication time inside the window", () => {
    expect(isInWindow("2024-03-05T12:00:00Z", window)).toBe(true);
  });

  it("rejects a publication time before the window start", () => {
    expect(isInWindow("2021-10-24T11:59:59Z", window)).toBe(false);
  });

  it("rejects a publication time after the window end", () => {
    expect(isInWindow("2026-10-24T12:00:01Z", window)).toBe(false);
  });

  it("includes both boundaries", () => {
    expect(isInWindow(window.start, window)).toBe(true);
    expect(isInWindow(window.end, window)).toBe(true);
  });

  it("rejects an undatable video rather than assuming it qualifies", () => {
    expect(isInWindow("", window)).toBe(false);
    expect(isInWindow("not a date", window)).toBe(false);
  });
});
