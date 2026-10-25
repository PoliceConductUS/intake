import { appendFile } from "node:fs/promises";

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

export type DateWindow = { publishedAfter?: string; publishedBefore?: string };

/** A channel's identity: its immutable id, plus its mutable display provenance. */
export type YoutubeChannel = {
  channelId: string;
  handle: string;
  title: string;
};

export type YoutubeApi = {
  /** The immutable channel id for a handle like `@PoliceActivity`, or null. */
  resolveChannelId(handle: string): Promise<string | null>;
  /**
   * The channel with this immutable id, or null when the id resolves to nothing.
   * Selecting by id is the stable way to name a channel: a handle can be renamed
   * or transferred to a different channel, an id cannot.
   */
  fetchChannelById(channelId: string): Promise<YoutubeChannel | null>;
  /** One search call (up to 50 hits) within a channel, optionally date-bounded. */
  searchChannelVideos(
    channelId: string,
    query: string,
    window?: DateWindow,
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

/** Thrown when the YouTube quota is exhausted, to halt a run (not skip). */
export class YoutubeQuotaError extends Error {}

// A YouTube quota/rate signal, in either shape Google uses: the older 403 with a
// `reason` (quotaExceeded/dailyLimitExceeded — daily budget spent) and the newer
// 429 RESOURCE_EXHAUSTED with `reason: rateLimitExceeded` (Search Queries limit).
// Both halt the run rather than skip-and-retry the next agency, which would just
// hammer the same exhausted quota.
const QUOTA_REASONS = new Set([
  "quotaExceeded",
  "dailyLimitExceeded",
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

/** True when a body reports the quota is spent (403 daily or 429 rate-limit). */
export function isQuotaExhaustedBody(body: unknown): boolean {
  const error = record(record(body).error);
  if (str(error.status) === "RESOURCE_EXHAUSTED") return true;
  const errors = error.errors;
  return (Array.isArray(errors) ? errors : []).some((entry) =>
    QUOTA_REASONS.has(str(record(entry).reason)),
  );
}

// The next midnight Pacific (America/Los_Angeles) as a YYYY-MM-DD date — when the
// YouTube DAILY quota resets. DST-aware via Intl; the response carries no reset
// timestamp, so it is computed, not read.
function nextPacificResetDate(now: Date): string {
  const pacificToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(now);
  const [year, month, day] = pacificToday.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(tomorrow);
}

/**
 * A human hint about when an exhausted quota resets, chosen by the error's reason
 * — the daily budget resets at midnight Pacific; the per-minute Search cap resets
 * within a minute (but persistent failures mean the daily budget is spent/too
 * low). Google returns no reset timestamp, so the daily time is computed.
 */
export function quotaResetHint(body: unknown, now: Date): string {
  const error = record(record(body).error);
  const reasons = (Array.isArray(error.errors) ? error.errors : []).map(
    (entry) => str(record(entry).reason),
  );
  const isDaily = reasons.some(
    (reason) => reason === "quotaExceeded" || reason === "dailyLimitExceeded",
  );
  if (isDaily) {
    return `daily quota — resets at 00:00 America/Los_Angeles (${nextPacificResetDate(now)})`;
  }
  return `per-minute Search cap — resets within ~60s, but persistent failures mean the project's daily Search quota is spent or too low: raise it in the Cloud console or wait for the 00:00 America/Los_Angeles reset (${nextPacificResetDate(now)})`;
}

export function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The real network fetchers a channel source's acquire wires into
 * `createYoutubeApi`: the API key is appended, every response is appended
 * verbatim to `apiLogPath` as evidence, 429/5xx retry with capped backoff, and an
 * exhausted quota throws `YoutubeQuotaError` to halt the run rather than hammer
 * the same spent quota on the next agency.
 */
export function createKeyedYoutubeFetchers(deps: {
  sourceId: string;
  apiKey: string;
  apiLogPath: string;
  logger?: { info: (message: string) => void };
}): {
  fetchJson: (url: string) => Promise<Record<string, unknown>>;
  fetchText: (url: string) => Promise<string>;
} {
  const log = deps.logger ?? { info() {} };
  return {
    async fetchJson(url) {
      const keyed = `${url}${url.includes("?") ? "&" : "?"}key=${deps.apiKey}`;
      for (let attempt = 0; ; attempt += 1) {
        const response = await fetch(keyed);
        const text = await response.text();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
        await appendFile(
          // codeql[js/http-to-file-access] This fixed JSONL file preserves the source response for audit; downstream transforms parse JSON and never execute it.
          deps.apiLogPath,
          `${JSON.stringify({ at: new Date().toISOString(), url, status: response.status, body })}\n`,
        );
        if (response.ok) return body as Record<string, unknown>;
        if (isQuotaExhaustedBody(body)) {
          throw new YoutubeQuotaError(
            `${deps.sourceId}: YouTube quota exhausted (${response.status}); ${quotaResetHint(body, new Date())}. Stopping (resumes next run).`,
          );
        }
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= MAX_RETRIES) {
          throw new Error(`${deps.sourceId}: ${response.status} for ${url}`);
        }
        const waitMs = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
        log.info(
          `${deps.sourceId}: ${response.status}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES}).`,
        );
        await sleep(waitMs);
      }
    },
    async fetchText(url) {
      const response = await fetch(url);
      return response.ok ? response.text() : "";
    },
  };
}

export function createYoutubeApi(deps: {
  fetchJson: (url: string) => Promise<Record<string, unknown>>;
  fetchText: (url: string) => Promise<string>;
}): YoutubeApi {
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

    async fetchChannelById(channelId) {
      const body = await deps.fetchJson(
        `${api}/channels?part=snippet&id=${encodeURIComponent(channelId)}`,
      );
      const items = Array.isArray(body.items) ? body.items : [];
      const entry = record(items[0]);
      const id = str(entry.id);
      if (id === "") return null;
      const snippet = record(entry.snippet);
      return {
        channelId: id,
        handle: str(snippet.customUrl),
        title: str(snippet.title),
      };
    },

    async searchChannelVideos(channelId, query, window = {}) {
      const params = new URLSearchParams({
        part: "snippet",
        channelId,
        q: query,
        type: "video",
        maxResults: "50",
        order: "date",
      });
      if (window.publishedAfter !== undefined)
        params.set("publishedAfter", window.publishedAfter);
      if (window.publishedBefore !== undefined)
        params.set("publishedBefore", window.publishedBefore);
      const body = await deps.fetchJson(`${api}/search?${params.toString()}`);
      const hits: YoutubeSearchHit[] = [];
      const seen = new Set<string>();
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
