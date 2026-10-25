import { describe, it, expect } from "vitest";
import {
  mergedVideos,
  nextBackfillYear,
  nextRefreshYear,
  prunedEntry,
  type AgencyVideoCacheEntry,
} from "../../../sources/youtube.donutoperator/video-cache.js";

function video(id: string, over: Record<string, unknown> = {}) {
  return {
    videoId: id,
    title: id,
    description: "",
    publishedAt: "",
    channelId: "UCwkm_Wcyh0pc7UUmZZfL-6w",
    url: `https://www.youtube.com/watch?v=${id}`,
    captions: null,
    retrievedAt: "2026-06-01T00:00:00Z",
    ...over,
  };
}

function entry(
  years: Record<
    string,
    { searchedAt: string; videos?: ReturnType<typeof video>[] }
  >,
): AgencyVideoCacheEntry {
  return {
    years: Object.fromEntries(
      Object.entries(years).map(([year, value]) => [
        year,
        { searchedAt: value.searchedAt, videos: value.videos ?? [] },
      ]),
    ),
  };
}

describe("nextBackfillYear", () => {
  it("starts at the current year for an agency never searched", () => {
    expect(nextBackfillYear(undefined, 2021, 2026)).toBe(2026);
  });

  it("walks back to the newest year not yet searched", () => {
    const cached = entry({
      "2026": { searchedAt: "2026-06-01T00:00:00Z" },
      "2025": { searchedAt: "2026-06-01T00:00:00Z" },
    });
    expect(nextBackfillYear(cached, 2021, 2026)).toBe(2024);
  });

  it("returns null once every year in the window has been searched at least once", () => {
    const cached = entry({
      "2026": { searchedAt: "2026-06-01T00:00:00Z" },
      "2025": { searchedAt: "2026-06-01T00:00:00Z" },
    });
    expect(nextBackfillYear(cached, 2025, 2026)).toBeNull();
  });
});

describe("nextRefreshYear", () => {
  it("re-searches the current year, which cannot be final yet", () => {
    const cached = entry({ "2026": { searchedAt: "2026-06-01T00:00:00Z" } });
    expect(nextRefreshYear(cached, 2021, 2026)).toBe(2026);
  });

  it("treats a year searched after it ended as final", () => {
    const cached = entry({
      "2026": { searchedAt: "2027-01-01T00:00:00Z" },
      "2025": { searchedAt: "2026-01-01T00:00:00Z" },
    });
    expect(nextRefreshYear(cached, 2025, 2026)).toBeNull();
  });

  it("re-searches a past year that was searched while it was still running", () => {
    const cached = entry({
      "2026": { searchedAt: "2027-01-01T00:00:00Z" },
      // Searched mid-2025, so uploads from the rest of 2025 were never seen.
      "2025": { searchedAt: "2025-06-01T00:00:00Z" },
    });
    expect(nextRefreshYear(cached, 2021, 2026)).toBe(2025);
  });

  it("never proposes a year that has not been searched at all (that is backfill's job)", () => {
    expect(nextRefreshYear(undefined, 2021, 2026)).toBeNull();
  });

  it("re-searches a year whose search stamp is unparseable", () => {
    const cached = entry({ "2024": { searchedAt: "whenever" } });
    expect(nextRefreshYear(cached, 2021, 2026)).toBe(2024);
  });
});

describe("prunedEntry", () => {
  it("drops years that have fallen out of the window and keeps the floor year", () => {
    const cached = entry({
      "2026": { searchedAt: "t" },
      "2021": { searchedAt: "t" },
      "2020": { searchedAt: "t" },
      "2019": { searchedAt: "t" },
    });
    const { entry: kept, droppedYears } = prunedEntry(cached, 2021);
    expect(Object.keys(kept.years).sort()).toEqual(["2021", "2026"]);
    expect(droppedYears).toEqual([2019, 2020]);
  });

  it("is a no-op for an agency with no cache yet", () => {
    expect(prunedEntry(undefined, 2021)).toEqual({
      entry: { years: {} },
      droppedYears: [],
    });
  });
});

describe("mergedVideos", () => {
  it("merges every cached year, de-duplicates by videoId, and orders stably", () => {
    const cached = entry({
      "2026": { searchedAt: "t", videos: [video("b"), video("a")] },
      "2025": { searchedAt: "t", videos: [video("c"), video("b")] },
    });
    expect(mergedVideos(cached).map((v) => v.videoId)).toEqual(["a", "b", "c"]);
  });

  it("prefers the newer cached year's copy of a duplicate", () => {
    const cached = entry({
      "2026": { searchedAt: "t", videos: [video("b", { title: "refreshed" })] },
      "2025": { searchedAt: "t", videos: [video("b", { title: "stale" })] },
    });
    expect(mergedVideos(cached)[0].title).toBe("refreshed");
  });

  it("returns nothing for an agency with no cache yet", () => {
    expect(mergedVideos(undefined)).toEqual([]);
  });
});
