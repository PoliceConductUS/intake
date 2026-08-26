import { describe, it, expect } from "vitest";
import {
  createYoutubeApi,
  isQuotaExhaustedBody,
  videoUrl,
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

  it("is false for other errors and non-error bodies", () => {
    expect(
      isQuotaExhaustedBody({ error: { errors: [{ reason: "badRequest" }] } }),
    ).toBe(false);
    expect(isQuotaExhaustedBody({ items: [] })).toBe(false);
    expect(isQuotaExhaustedBody("nope")).toBe(false);
  });
});

function apiWith(
  jsonByUrl: Record<string, unknown>,
  textByUrl: Record<string, string> = {},
) {
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
    fetchText: async (url) => {
      const key = Object.keys(textByUrl).find((k) => url.includes(k));
      return key === undefined ? "" : textByUrl[key];
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

  it("issues one date-bounded search call and parses/de-duplicates its hits", async () => {
    const { api, jsonCalls } = apiWith({
      "channelId=UCpa123": {
        items: [
          {
            id: { videoId: "v1" },
            snippet: {
              title: "T1",
              description: "D1",
              publishedAt: "2024-06-01T00:00:00Z",
              channelId: "UCpa123",
            },
          },
          { id: { videoId: "v1" }, snippet: { title: "dupe" } },
          { id: { videoId: "v2" }, snippet: { title: "T2" } },
        ],
        nextPageToken: "PT2",
      },
    });

    const hits = await api.searchChannelVideos("UCpa123", "Irving Police", {
      publishedAfter: "2024-01-01T00:00:00Z",
      publishedBefore: "2025-01-01T00:00:00Z",
    });

    // Exactly one search call, ignoring nextPageToken, with the date window.
    const searchCalls = jsonCalls.filter((u) => u.includes("/search?"));
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0]).toContain("publishedAfter=2024-01-01T00%3A00%3A00Z");
    expect(searchCalls[0]).toContain(
      "publishedBefore=2025-01-01T00%3A00%3A00Z",
    );
    expect(hits.map((h) => h.videoId)).toEqual(["v1", "v2"]);
    expect(hits[0]).toEqual({
      videoId: "v1",
      title: "T1",
      description: "D1",
      publishedAt: "2024-06-01T00:00:00Z",
      channelId: "UCpa123",
      url: videoUrl("v1"),
    });
  });

  it("extracts caption text and returns null when none exist", async () => {
    const { api } = apiWith(
      {},
      {
        "v=hascaps":
          "<transcript><text start='0'>Officer Smith on scene</text></transcript>",
      },
    );
    expect(await api.fetchCaptions("hascaps")).toBe("Officer Smith on scene");
    expect(await api.fetchCaptions("nocaps")).toBeNull();
  });
});
