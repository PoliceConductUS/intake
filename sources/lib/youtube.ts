// A small YouTube Data API v3 client for the video-coverage sources (issue #52).
// Network access is injected (`fetchJson` for the Data API, `fetchText` for the
// timedtext caption track) so a source's acquire wires the real, keyed, retrying
// fetch and tests inject fakes — the client itself is deterministic.

export type YoutubeSearchHit = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  url: string;
};

export type YoutubeApi = {
  /** The immutable channel id for a handle like `@PoliceActivity`, or null. */
  resolveChannelId(handle: string): Promise<string | null>;
  /** Video hits within a channel for a query (paged up to `maxPages`). */
  searchChannelVideos(
    channelId: string,
    query: string,
  ): Promise<YoutubeSearchHit[]>;
  /** The caption/transcript text for a video, or null when none is available. */
  fetchCaptions(videoId: string): Promise<string | null>;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function createYoutubeApi(deps: {
  fetchJson: (url: string) => Promise<Record<string, unknown>>;
  fetchText: (url: string) => Promise<string>;
  maxPages?: number;
}): YoutubeApi {
  const maxPages = deps.maxPages ?? 4;
  const api = "https://www.googleapis.com/youtube/v3";

  return {
    async resolveChannelId(handle) {
      const clean = handle.replace(/^@/, "");
      const body = await deps.fetchJson(
        `${api}/channels?part=id&forHandle=${encodeURIComponent(clean)}`,
      );
      const items = Array.isArray(body.items) ? body.items : [];
      const id = str(record(items[0]).id);
      return id === "" ? null : id;
    },

    async searchChannelVideos(channelId, query) {
      const hits: YoutubeSearchHit[] = [];
      const seen = new Set<string>();
      let pageToken = "";
      for (let page = 0; page < maxPages; page += 1) {
        const params = new URLSearchParams({
          part: "snippet",
          channelId,
          q: query,
          type: "video",
          maxResults: "50",
          order: "relevance",
        });
        if (pageToken !== "") params.set("pageToken", pageToken);
        const body = await deps.fetchJson(`${api}/search?${params.toString()}`);
        for (const item of Array.isArray(body.items) ? body.items : []) {
          const entry = record(item);
          const videoId = str(record(entry.id).videoId);
          if (videoId === "" || seen.has(videoId)) continue;
          seen.add(videoId);
          const snippet = record(entry.snippet);
          hits.push({
            videoId,
            title: str(snippet.title),
            description: str(snippet.description),
            publishedAt: str(snippet.publishedAt),
            channelId: str(snippet.channelId) || channelId,
            url: videoUrl(videoId),
          });
        }
        pageToken = str(body.nextPageToken);
        if (pageToken === "") break;
      }
      return hits;
    },

    async fetchCaptions(videoId) {
      // Best-effort English timedtext track. Empty body ⇒ no captions available.
      const xml = await deps.fetchText(
        `https://www.youtube.com/api/timedtext?lang=en&v=${encodeURIComponent(videoId)}`,
      );
      const text = xml
        .replace(/<[^>]+>/g, " ")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
      return text === "" ? null : text;
    },
  };
}
