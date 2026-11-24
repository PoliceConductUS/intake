import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  loadVideoCache,
  mergedVideos,
  nextYearToAcquire,
  type AgencyVideoCacheEntry,
} from "../../../sources/com/youtube/policeactivity/video-cache.js";

function video(id: string) {
  return {
    videoId: id,
    title: id,
    description: "",
    publishedAt: "",
    channelId: "c",
    url: `https://www.youtube.com/watch?v=${id}`,
  };
}

describe("nextYearToAcquire", () => {
  const afterYearEnd = (year: number) => ({
    searchedAt: `${year + 1}-02-01T00:00:00.000Z`,
    videos: [],
  });
  const duringYear = (year: number, month: string) => ({
    searchedAt: `${year}-${month}-01T00:00:00.000Z`,
    videos: [],
  });

  it("returns the current year for an agency never searched", () => {
    expect(nextYearToAcquire(undefined, 2020, 2024)).toBe(2024);
  });

  it("walks back to the newest year not yet searched", () => {
    const entry: AgencyVideoCacheEntry = {
      years: { "2024": duringYear(2024, "03"), "2023": afterYearEnd(2023) },
    };
    expect(nextYearToAcquire(entry, 2020, 2024)).toBe(2022);
  });

  it("returns the current year again once backfilled to the floor", () => {
    const entry: AgencyVideoCacheEntry = {
      years: { "2024": duringYear(2024, "03"), "2023": afterYearEnd(2023) },
    };
    expect(nextYearToAcquire(entry, 2023, 2024)).toBe(2024);
  });

  it("returns a past year that was last searched before it ended, ahead of the current year", () => {
    const entry: AgencyVideoCacheEntry = {
      years: { "2024": duringYear(2024, "03"), "2023": duringYear(2023, "11") },
    };
    expect(nextYearToAcquire(entry, 2023, 2024)).toBe(2023);
  });

  it("never returns a past year searched after it ended", () => {
    const entry: AgencyVideoCacheEntry = {
      years: { "2023": afterYearEnd(2023), "2022": afterYearEnd(2022) },
    };
    expect(nextYearToAcquire(entry, 2022, 2023)).toBeNull();
  });

  it("returns null when the floor year is after the current year", () => {
    expect(nextYearToAcquire(undefined, 2025, 2024)).toBeNull();
  });
});

describe("loadVideoCache", () => {
  it("is empty when the cache file does not exist", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "youtube-cache-"));
    try {
      expect(await loadVideoCache(dir)).toEqual({ agencies: {} });
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws on a cache file that cannot be parsed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "youtube-cache-"));
    try {
      await writeFile(path.join(dir, "video-cache.json"), "{ not json");
      await expect(loadVideoCache(dir)).rejects.toThrow(SyntaxError);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("throws on a cache file with no agencies", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "youtube-cache-"));
    try {
      await writeFile(path.join(dir, "video-cache.json"), "{}");
      await expect(loadVideoCache(dir)).rejects.toThrow(
        /video-cache\.json has no agencies/,
      );
    } finally {
      await rm(dir, { recursive: true });
    }
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
