import { describe, it, expect } from "vitest";
import { createYoutubeApi, videoUrl } from "../../../sources/lib/youtube.js";

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

  it("parses, de-duplicates, and paginates channel search hits", async () => {
    const { api } = apiWith({
      // Page 2 (checked first): repeats v1 (deduped) and adds v2. Page 1 (no
      // pageToken) falls through to the channelId key and returns nextPageToken.
      "pageToken=PT2": {
        items: [
          { id: { videoId: "v1" }, snippet: { title: "dupe" } },
          {
            id: { videoId: "v2" },
            snippet: { title: "T2", description: "D2" },
          },
        ],
      },
      "channelId=UCpa123": {
        items: [
          {
            id: { videoId: "v1" },
            snippet: {
              title: "T1",
              description: "D1",
              publishedAt: "2024-01-01T00:00:00Z",
              channelId: "UCpa123",
            },
          },
        ],
        nextPageToken: "PT2",
      },
    });

    const hits = await api.searchChannelVideos("UCpa123", "Irving Police");
    expect(hits.map((h) => h.videoId)).toEqual(["v1", "v2"]);
    expect(hits[0]).toEqual({
      videoId: "v1",
      title: "T1",
      description: "D1",
      publishedAt: "2024-01-01T00:00:00Z",
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
