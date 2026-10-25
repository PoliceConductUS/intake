import { describe, it, expect } from "vitest";
import {
  mergedVideos,
  nextYearToAcquire,
  pruneToWindow,
  type AgencyVideoCacheEntry,
} from "../../../sources/youtube.audittheaudit/video-cache.js";

const window = {
  startsAt: "2021-10-24T12:00:00.000Z",
  endsAt: "2026-10-24T12:00:00.000Z",
};

function video(id: string) {
  return {
    videoId: id,
    title: id,
    description: "",
    publishedAt: "2024-01-01T00:00:00Z",
    channelId: "UCc-0YpRpqgA5lPTpSQ5uo-Q",
    url: `https://www.youtube.com/watch?v=${id}`,
  };
}

function searched(...years: number[]): AgencyVideoCacheEntry {
  return {
    years: Object.fromEntries(
      years.map((year) => [String(year), { searchedAt: "t", videos: [] }]),
    ),
  };
}

describe("nextYearToAcquire", () => {
  it("starts at the open year for an agency never searched", () => {
    expect(nextYearToAcquire(undefined, window)).toBe(2026);
  });

  it("backfills the newest year not yet searched", () => {
    expect(nextYearToAcquire(searched(2026, 2025), window)).toBe(2024);
  });

  it("re-searches the open year once the window is backfilled", () => {
    expect(
      nextYearToAcquire(searched(2026, 2025, 2024, 2023, 2022, 2021), window),
    ).toBe(2026);
  });
});

describe("pruneToWindow", () => {
  it("drops the years the window has rolled past", () => {
    const pruned = pruneToWindow(
      { agencies: { "agency-1": searched(2026, 2021, 2020, 2019) } },
      window,
    );
    expect(Object.keys(pruned.agencies["agency-1"].years).sort()).toEqual([
      "2021",
      "2026",
    ]);
  });

  it("keeps each agency keyed by its own source id", () => {
    const pruned = pruneToWindow(
      {
        agencies: {
          "agency-1": {
            years: { "2024": { searchedAt: "t", videos: [video("a")] } },
          },
          "agency-2": {
            years: { "2024": { searchedAt: "t", videos: [video("b")] } },
          },
        },
      },
      window,
    );
    expect(
      mergedVideos(pruned.agencies["agency-1"]).map((v) => v.videoId),
    ).toEqual(["a"]);
    expect(
      mergedVideos(pruned.agencies["agency-2"]).map((v) => v.videoId),
    ).toEqual(["b"]);
  });
});

describe("mergedVideos", () => {
  it("merges every cached year and de-duplicates by videoId", () => {
    const entry: AgencyVideoCacheEntry = {
      years: {
        "2024": { searchedAt: "t", videos: [video("a"), video("b")] },
        "2023": { searchedAt: "t", videos: [video("b"), video("c")] },
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
