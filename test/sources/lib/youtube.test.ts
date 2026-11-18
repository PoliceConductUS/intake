import { describe, it, expect } from "vitest";
import {
  createYoutubeApi,
  isQuotaExhaustedBody,
  quotaResetHint,
} from "../../../sources/lib/youtube.js";

describe("isQuotaExhaustedBody", () => {
  it("detects a quotaExceeded / dailyLimitExceeded 403 body", () => {
    expect(
      isQuotaExhaustedBody({
        error: { errors: [{ reason: "quotaExceeded" }] },
      }),
    ).toBe(true);
    expect(
      isQuotaExhaustedBody({
        error: { errors: [{ reason: "dailyLimitExceeded" }] },
      }),
    ).toBe(true);
  });

  it("detects the 429 rate-limit / RESOURCE_EXHAUSTED body", () => {
    // Verbatim shape logged by search.list when the Search Queries quota is hit.
    expect(
      isQuotaExhaustedBody({
        error: {
          code: 429,
          message:
            "Quota exceeded for quota metric 'Search Queries' and limit 'Search Queries per minute'.",
          errors: [{ reason: "rateLimitExceeded", domain: "global" }],
          status: "RESOURCE_EXHAUSTED",
        },
      }),
    ).toBe(true);
    // status alone is enough, even without a recognized reason.
    expect(
      isQuotaExhaustedBody({ error: { status: "RESOURCE_EXHAUSTED" } }),
    ).toBe(true);
  });

  it("names the next Pacific-midnight reset date, by reason", () => {
    // 2026-08-26T12:00Z is 2026-08-26 in Pacific (PDT), so the daily quota resets
    // the next Pacific midnight, 2026-08-27. Oracle: the calendar date after the
    // Pacific date of `now`, independent of the formatter under test.
    const now = new Date("2026-08-26T12:00:00Z");
    expect(
      quotaResetHint({ error: { errors: [{ reason: "quotaExceeded" }] } }, now),
    ).toBe("daily quota — resets at 00:00 America/Los_Angeles (2026-08-27)");

    const rate = quotaResetHint(
      { error: { errors: [{ reason: "rateLimitExceeded" }] }, status: 429 },
      now,
    );
    expect(rate).toContain("per-minute Search cap");
    expect(rate).toContain("2026-08-27");
  });

  it("is false for other errors and non-error bodies", () => {
    expect(
      isQuotaExhaustedBody({ error: { errors: [{ reason: "badRequest" }] } }),
    ).toBe(false);
    expect(isQuotaExhaustedBody({ items: [] })).toBe(false);
    expect(isQuotaExhaustedBody("nope")).toBe(false);
  });
});

function apiWith(jsonByUrl: Record<string, unknown>) {
  const jsonCalls: string[] = [];
  const api = createYoutubeApi({
    fetchJson: async (url) => {
      jsonCalls.push(url);
      const key = Object.keys(jsonByUrl).find((k) => url.includes(k));
      return (key === undefined ? {} : jsonByUrl[key]) as Record<
        string,
        unknown
      >;
    },
  });
  return { api, jsonCalls };
}

describe("youtube api client", () => {
  it("resolves a channel id from a handle", async () => {
    const { api } = apiWith({
      "channels?part=id&forHandle=PoliceActivity": {
        items: [{ id: "UCpa123" }],
      },
    });
    expect(await api.resolveChannelId("@PoliceActivity")).toBe("UCpa123");
  });

  it("returns null when the handle resolves to no channel", async () => {
    const { api } = apiWith({ "channels?part=id": { items: [] } });
    expect(await api.resolveChannelId("@Nope")).toBeNull();
  });

  const hit = (videoId: string) => ({
    id: { videoId },
    snippet: {
      title: `T-${videoId}`,
      description: `D-${videoId}`,
      publishedAt: "2024-06-01T00:00:00Z",
      channelId: "UCpa123",
    },
  });

  it("pages a date-bounded search through nextPageToken and de-duplicates its hits", async () => {
    const { api, jsonCalls } = apiWith({
      "pageToken=PT3": { items: [hit("v4")] },
      "pageToken=PT2": { items: [hit("v2"), hit("v3")], nextPageToken: "PT3" },
      "channelId=UCpa123": {
        items: [hit("v1"), hit("v1"), hit("v2")],
        nextPageToken: "PT2",
      },
    });

    const hits = await api.searchChannelVideos("UCpa123", "Irving Police", {
      publishedAfter: "2024-01-01T00:00:00Z",
      publishedBefore: "2025-01-01T00:00:00Z",
    });

    const searchCalls = jsonCalls.filter((u) => u.includes("/search?"));
    expect(searchCalls).toHaveLength(3);
    expect(searchCalls[0]).not.toContain("pageToken");
    expect(searchCalls[1]).toContain("pageToken=PT2");
    expect(searchCalls[2]).toContain("pageToken=PT3");
    for (const call of searchCalls) {
      expect(call).toContain("maxResults=50");
      expect(call).toContain("publishedAfter=2024-01-01T00%3A00%3A00Z");
      expect(call).toContain("publishedBefore=2025-01-01T00%3A00%3A00Z");
    }
    expect(hits.map((h) => h.videoId)).toEqual(["v1", "v2", "v3", "v4"]);
    expect(hits[0]).toEqual({
      videoId: "v1",
      title: "T-v1",
      description: "D-v1",
      publishedAt: "2024-06-01T00:00:00Z",
      channelId: "UCpa123",
      url: "https://www.youtube.com/watch?v=v1",
    });
  });

  it("throws when a search reaches the API limit of 500 videos", async () => {
    let page = 0;
    const api = createYoutubeApi({
      fetchJson: async () => {
        page += 1;
        return {
          items: Array.from({ length: 50 }, (_, i) => hit(`p${page}-${i}`)),
          ...(page < 10 ? { nextPageToken: `PT${page + 1}` } : {}),
        };
      },
    });

    await expect(
      api.searchChannelVideos("UCpa123", "Houston Police"),
    ).rejects.toThrow(/Houston Police.*500 videos/);
    expect(page).toBe(10);
  });

  it("throws on a search hit with no video id", async () => {
    const { api } = apiWith({
      "channelId=UCpa123": { items: [{ id: {}, snippet: { title: "T" } }] },
    });
    await expect(
      api.searchChannelVideos("UCpa123", "Irving Police"),
    ).rejects.toThrow(/Irving Police.*no video ID/);
  });

  it("throws on a search response with no items list", async () => {
    const { api } = apiWith({ "channelId=UCpa123": { kind: "other" } });
    await expect(
      api.searchChannelVideos("UCpa123", "Irving Police"),
    ).rejects.toThrow(/Irving Police.*no items list/);
  });
});
