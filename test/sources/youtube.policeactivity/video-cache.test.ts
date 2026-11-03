import { describe, it, expect } from "vitest";
import type { PublicationWindow } from "../../../sources/lib/rolling-window.js";
import {
  inWindowVideos,
  nextSliceToSearch,
  recordSlice,
  windowYears,
  type AcquiredVideo,
  type AgencyVideoCacheEntry,
} from "../../../sources/youtube.policeactivity/video-cache.js";

// The window a run on 2026-10-24 computes.
const window: PublicationWindow = {
  start: "2021-10-24T00:00:00.000Z",
  end: "2026-10-24T00:00:00.000Z",
};

function video(
  id: string,
  publishedAt: string,
  overrides: Partial<AcquiredVideo> = {},
): AcquiredVideo {
  return {
    videoId: id,
    title: id,
    description: "",
    publishedAt,
    channelId: "UCpa123",
    url: `https://www.youtube.com/watch?v=${id}`,
    retrievedAt: "2026-10-24T00:00:00.000Z",
    ...overrides,
  };
}

function searched(...years: number[]): AgencyVideoCacheEntry {
  return {
    years: Object.fromEntries(
      years.map((year) => [
        String(year),
        { searchedAt: "2026-10-24T00:00:00.000Z", videos: [] },
      ]),
    ),
  };
}

describe("windowYears", () => {
  it("is every calendar year the window touches, newest first", () => {
    expect(windowYears(window)).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
  });
});

describe("nextSliceToSearch", () => {
  it("starts an unsearched agency at the year the window ends in", () => {
    expect(nextSliceToSearch(undefined, window)).toEqual({
      year: 2026,
      publishedAfter: "2026-01-01T00:00:00.000Z",
      publishedBefore: window.end,
      refresh: false,
    });
  });

  it("walks back to the newest year not yet searched", () => {
    expect(nextSliceToSearch(searched(2026, 2025), window)).toEqual({
      year: 2024,
      publishedAfter: "2024-01-01T00:00:00.000Z",
      publishedBefore: "2025-01-01T00:00:00.000Z",
      refresh: false,
    });
  });

  it("clips the oldest slice to the window, never searching before it", () => {
    const slice = nextSliceToSearch(
      searched(2026, 2025, 2024, 2023, 2022),
      window,
    );
    expect(slice).toEqual({
      year: 2021,
      publishedAfter: window.start,
      publishedBefore: "2022-01-01T00:00:00.000Z",
      refresh: false,
    });
  });

  it("re-searches the window's end year once the backfill is complete", () => {
    // The only slice that can still gain videos, so a fully backfilled agency
    // keeps picking up new uploads instead of never being searched again.
    const slice = nextSliceToSearch(
      searched(2026, 2025, 2024, 2023, 2022, 2021),
      window,
    );
    expect(slice).toEqual({
      year: 2026,
      publishedAfter: "2026-01-01T00:00:00.000Z",
      publishedBefore: window.end,
      refresh: true,
    });
  });
});

describe("recordSlice", () => {
  const slice = nextSliceToSearch(undefined, window);

  it("records the slice's videos under its year with the search time", () => {
    const entry = recordSlice(undefined, slice, "2026-10-24T01:00:00.000Z", [
      video("a", "2026-02-01T00:00:00Z"),
    ]);
    expect(entry.years["2026"].searchedAt).toBe("2026-10-24T01:00:00.000Z");
    expect(entry.years["2026"].videos.map((v) => v.videoId)).toEqual(["a"]);
  });

  it("keeps other years untouched", () => {
    const entry = recordSlice(searched(2023), slice, "t", []);
    expect(Object.keys(entry.years).sort()).toEqual(["2023", "2026"]);
  });

  it("lets the newest observation of a video replace the cached one", () => {
    const first = recordSlice(undefined, slice, "t1", [
      video("a", "2026-02-01T00:00:00Z", { title: "old title" }),
    ]);
    const second = recordSlice(first, slice, "t2", [
      video("a", "2026-02-01T00:00:00Z", {
        title: "new title",
        retrievedAt: "2026-10-25T00:00:00.000Z",
      }),
    ]);
    expect(second.years["2026"].videos).toEqual([
      video("a", "2026-02-01T00:00:00Z", {
        title: "new title",
        retrievedAt: "2026-10-25T00:00:00.000Z",
      }),
    ]);
  });

  it("keeps a video the search no longer returns", () => {
    const first = recordSlice(undefined, slice, "t1", [
      video("gone", "2026-02-01T00:00:00Z"),
    ]);
    const second = recordSlice(first, slice, "t2", [
      video("b", "2026-03-01T00:00:00Z"),
    ]);
    expect(second.years["2026"].videos.map((v) => v.videoId).sort()).toEqual([
      "b",
      "gone",
    ]);
  });
});

describe("inWindowVideos", () => {
  it("merges every cached year, newest published first", () => {
    const entry: AgencyVideoCacheEntry = {
      years: {
        "2026": {
          searchedAt: "t",
          videos: [video("new", "2026-05-01T00:00:00Z")],
        },
        "2023": {
          searchedAt: "t",
          videos: [video("old", "2023-05-01T00:00:00Z")],
        },
      },
    };
    expect(inWindowVideos(entry, window).map((v) => v.videoId)).toEqual([
      "new",
      "old",
    ]);
  });

  it("drops a video that has aged out of the window", () => {
    const entry: AgencyVideoCacheEntry = {
      years: {
        "2021": {
          searchedAt: "t",
          videos: [
            video("in", "2021-11-01T00:00:00Z"),
            video("aged-out", "2021-05-01T00:00:00Z"),
          ],
        },
      },
    };
    expect(inWindowVideos(entry, window).map((v) => v.videoId)).toEqual(["in"]);
  });

  it("de-duplicates by videoId, keeping the newest retrieval", () => {
    const entry: AgencyVideoCacheEntry = {
      years: {
        "2026": {
          searchedAt: "t",
          videos: [
            video("a", "2026-01-02T00:00:00Z", {
              title: "newest",
              retrievedAt: "2026-10-24T00:00:00.000Z",
            }),
          ],
        },
        "2025": {
          searchedAt: "t",
          videos: [
            video("a", "2026-01-02T00:00:00Z", {
              title: "stale",
              retrievedAt: "2025-01-01T00:00:00.000Z",
            }),
          ],
        },
      },
    };
    const merged = inWindowVideos(entry, window);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("newest");
  });

  it("is empty for an unsearched agency", () => {
    expect(inWindowVideos(undefined, window)).toEqual([]);
  });
});
