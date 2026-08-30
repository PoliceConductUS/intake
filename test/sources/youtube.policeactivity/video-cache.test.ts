import { describe, it, expect } from "vitest";
import {
  mergedVideos,
  nextYearToAcquire,
  type AgencyVideoCacheEntry,
} from "../../../sources/youtube.policeactivity/video-cache.js";

function video(id: string) {
  return {
    videoId: id,
    title: id,
    description: "",
    publishedAt: "",
    channelId: "c",
    url: `https://www.youtube.com/watch?v=${id}`,
    captions: null,
  };
}

describe("nextYearToAcquire", () => {
  it("returns the current year for an agency never searched", () => {
    expect(nextYearToAcquire(undefined, 2020, 2024)).toBe(2024);
  });

  it("walks back to the newest year not yet searched", () => {
    const entry: AgencyVideoCacheEntry = {
      years: {
        "2024": { searchedAt: "t", videos: [] },
        "2023": { searchedAt: "t", videos: [] },
      },
    };
    expect(nextYearToAcquire(entry, 2020, 2024)).toBe(2022);
  });

  it("returns null once backfilled to the floor", () => {
    const entry: AgencyVideoCacheEntry = {
      years: {
        "2024": { searchedAt: "t", videos: [] },
        "2023": { searchedAt: "t", videos: [] },
      },
    };
    expect(nextYearToAcquire(entry, 2023, 2024)).toBeNull();
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
