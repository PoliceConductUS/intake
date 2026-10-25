import { describe, it, expect } from "vitest";
import {
  canonicalVideoUrl,
  inWindow,
  normalizeVideoUrl,
  officerMentions,
  rollingWindowStart,
  ROLLING_WINDOW_YEARS,
} from "../../../sources/lib/youtube-channel.js";
import {
  mergedVideos,
  planYearToAcquire,
  pruneYearsBefore,
} from "../../../sources/lib/youtube-video-cache.js";

describe("rolling window", () => {
  it("opens exactly five years before the run", () => {
    expect(ROLLING_WINDOW_YEARS).toBe(5);
    expect(
      rollingWindowStart(new Date("2026-10-24T00:00:00.000Z")).toISOString(),
    ).toBe("2021-10-24T00:00:00.000Z");
  });

  it("includes both boundaries and excludes a video one second outside either", () => {
    const window = {
      startAt: "2021-10-24T00:00:00Z",
      endAt: "2026-10-24T00:00:00Z",
    };
    expect(inWindow("2021-10-24T00:00:00Z", window)).toBe(true);
    expect(inWindow("2026-10-24T00:00:00Z", window)).toBe(true);
    expect(inWindow("2021-10-23T23:59:59Z", window)).toBe(false);
    expect(inWindow("2026-10-24T00:00:01Z", window)).toBe(false);
  });

  it("treats an unparseable publication time as out of window", () => {
    const window = {
      startAt: "2021-10-24T00:00:00Z",
      endAt: "2026-10-24T00:00:00Z",
    };
    expect(inWindow("", window)).toBe(false);
    expect(inWindow("not a date", window)).toBe(false);
  });
});

describe("normalizeVideoUrl", () => {
  it("lowercases the host but preserves the case-sensitive video id", () => {
    expect(
      normalizeVideoUrl("https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("keeps two video ids that differ only in case distinct", () => {
    // coverage_links.normalized_url is UNIQUE: collapsing these would let one
    // video block the other, or attach officer links to the wrong video.
    const upper = normalizeVideoUrl(canonicalVideoUrl("AbCdEfGhIjK"));
    const lower = normalizeVideoUrl(canonicalVideoUrl("abcdefghijk"));
    expect(upper).not.toBe(lower);
  });

  it("strips trailing slashes and surrounding whitespace", () => {
    expect(normalizeVideoUrl("  https://www.youtube.com/watch?v=abc//  ")).toBe(
      "https://www.youtube.com/watch?v=abc",
    );
  });
});

describe("officerMentions", () => {
  it("finds distinct role-prefixed names across title, description and captions", () => {
    expect(
      officerMentions({
        title: "Officer John Smith on patrol",
        description: "Sergeant Jane Wilson responds.",
        captions: "Deputy John Smith again.",
      }),
    ).toEqual([
      { name: "John Smith", passage: "Officer John Smith" },
      { name: "Jane Wilson", passage: "Sergeant Jane Wilson" },
    ]);
  });

  it("finds nothing in text that names no officer", () => {
    expect(
      officerMentions({
        title: "Dashcam highlights",
        description: "General footage.",
        captions: null,
      }),
    ).toEqual([]);
  });
});

describe("planYearToAcquire", () => {
  const now = new Date("2026-10-24T00:00:00Z");
  const base = { floorYear: 2021, currentYear: 2026, now, refreshDays: 7 };

  it("searches the current year first for an agency never searched", () => {
    expect(planYearToAcquire(undefined, base)).toBe(2026);
  });

  it("re-searches the current year once its last search is stale", () => {
    const entry = {
      years: { "2026": { searchedAt: "2026-10-01T00:00:00Z", videos: [] } },
    };
    expect(planYearToAcquire(entry, base)).toBe(2026);
  });

  it("backfills the newest unsearched older year while the current year is fresh", () => {
    const entry = {
      years: {
        "2026": { searchedAt: "2026-10-23T00:00:00Z", videos: [] },
        "2025": { searchedAt: "2026-10-23T00:00:00Z", videos: [] },
      },
    };
    expect(planYearToAcquire(entry, base)).toBe(2024);
  });

  it("reports nothing to do once the whole window is covered and current", () => {
    const years: Record<string, { searchedAt: string; videos: [] }> = {};
    for (let year = 2021; year <= 2026; year += 1) {
      years[String(year)] = { searchedAt: "2026-10-23T00:00:00Z", videos: [] };
    }
    expect(planYearToAcquire({ years }, base)).toBe(null);
  });
});

describe("cache maintenance", () => {
  const video = (videoId: string) => ({
    videoId,
    title: videoId,
    description: "",
    publishedAt: "2024-01-01T00:00:00Z",
    channelId: "UC1",
    url: canonicalVideoUrl(videoId),
    retrievedAt: "2026-10-24T00:00:00Z",
    captions: null,
  });

  it("drops year buckets that fell out of the window", () => {
    const pruned = pruneYearsBefore(
      {
        years: {
          "2020": { searchedAt: "2021-01-01T00:00:00Z", videos: [video("a")] },
          "2022": { searchedAt: "2023-01-01T00:00:00Z", videos: [video("b")] },
        },
      },
      2021,
    );
    expect(Object.keys(pruned.years)).toEqual(["2022"]);
  });

  it("merges years into a stable, de-duplicated video list", () => {
    const entry = {
      years: {
        "2025": { searchedAt: "2026-01-01T00:00:00Z", videos: [video("b")] },
        "2024": {
          searchedAt: "2025-01-01T00:00:00Z",
          videos: [video("a"), video("b")],
        },
      },
    };
    expect(mergedVideos(entry).map((v) => v.videoId)).toEqual(["a", "b"]);
    expect(mergedVideos(entry)).toEqual(mergedVideos(entry));
  });
});
