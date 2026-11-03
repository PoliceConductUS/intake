import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/transform/source-transform.js";
import { slugify } from "../lib/civil-defendants.js";
import { rollingWindow } from "../lib/rolling-window.js";
import {
  createYoutubeApi,
  isQuotaExhaustedBody,
  quotaResetHint,
  YoutubeQuotaError,
} from "../lib/youtube.js";
import {
  CHANNEL_HANDLE,
  CHANNEL_URL,
  SOURCE_ID,
  SOURCE_NAME,
  stableChannelId,
  WINDOW_YEARS,
} from "./channel.js";
import {
  inWindowVideos,
  loadVideoCache,
  nextSliceToSearch,
  recordSlice,
  saveVideoCache,
  type AcquiredVideo,
} from "./video-cache.js";
import { ENVELOPE_SUFFIX, writeVideoEnvelope } from "./video-envelope.js";

const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60_000;
// Be gentle: a small pause between agency searches (we are in no rush).
const POLITE_DELAY_MS = 250;

function agencyQuery(name: string, place: string): string {
  return [name, place]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const acquire: SourceAcquire = async ({
  sourceDir,
  state,
  env,
  data,
  logger,
}: AcquireDeps) => {
  const log = logger ?? { info() {} };
  const apiKey = env.YOUTUBE_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error(
      `${SOURCE_ID}: YOUTUBE_API_KEY is required to search the channel.`,
    );
  }
  await mkdir(sourceDir, { recursive: true });
  const apiLogPath = path.join(sourceDir, ".api-calls.jsonl");

  const fetchJson = async (url: string): Promise<Record<string, unknown>> => {
    const keyed = `${url}${url.includes("?") ? "&" : "?"}key=${apiKey}`;
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
        apiLogPath,
        `${JSON.stringify({ at: new Date().toISOString(), url, status: response.status, body })}\n`,
      );
      if (response.ok) return body as Record<string, unknown>;
      if (isQuotaExhaustedBody(body)) {
        throw new YoutubeQuotaError(
          `${SOURCE_ID}: YouTube quota exhausted (${response.status}); ${quotaResetHint(body, new Date())}. Stopping (resumes next run).`,
        );
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        throw new Error(`${SOURCE_ID}: ${response.status} for ${url}`);
      }
      const waitMs = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
      log.info(
        `${SOURCE_ID}: ${response.status}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES}).`,
      );
      await sleep(waitMs);
    }
  };

  const youtube = createYoutubeApi({ fetchJson });
  const channelId = await stableChannelId(state, youtube.resolveChannelId);

  // The rolling publication window this run considers, fixed once so every
  // agency's searches and every envelope it writes share one window.
  const window = rollingWindow(new Date(), WINDOW_YEARS);
  const source = {
    name: SOURCE_NAME,
    handle: CHANNEL_HANDLE,
    channelUrl: CHANNEL_URL,
    channelId,
  };

  const cache = await loadVideoCache(state);
  let backfilled = 0;
  let refreshed = 0;
  let failed = 0;

  const processAgency = async (
    agencyId: string,
    agencyName: string,
    agencyState: string,
    place: string,
    county: string,
  ): Promise<void> => {
    if (agencyName === "") return;
    const slug = slugify(agencyName);
    const slice = nextSliceToSearch(cache.agencies[slug], window);

    try {
      const hits = await youtube.searchChannelVideos(
        channelId,
        agencyQuery(agencyName, place),
        {
          publishedAfter: slice.publishedAfter,
          publishedBefore: slice.publishedBefore,
        },
      );
      const retrievedAt = new Date().toISOString();
      const videos: AcquiredVideo[] = hits.map((hit) => ({
        ...hit,
        retrievedAt,
      }));
      cache.agencies[slug] = recordSlice(
        cache.agencies[slug],
        slice,
        retrievedAt,
        videos,
      );
      await saveVideoCache(state, cache);
      if (slice.refresh) refreshed += 1;
      else backfilled += 1;
      log.info(
        `${SOURCE_ID}: ${agencyName} ${slice.year}${slice.refresh ? " (refresh)" : ""} — ${videos.length} video(s)`,
      );
      await sleep(POLITE_DELAY_MS);
    } catch (error) {
      // Quota exhausted halts the whole run (every later call would 403 too); any
      // other single-agency failure is logged and the slice stays uncached so a
      // later run retries it. The envelope is still written from the cache, so a
      // previously skipped in-window video is still reconsidered this run.
      if (error instanceof YoutubeQuotaError) throw error;
      failed += 1;
      log.info(
        `${SOURCE_ID}: ${agencyName} ${slice.year} — search failed, skipped (${error instanceof Error ? error.message : String(error)}).`,
      );
    }

    await writeVideoEnvelope(
      path.join(sourceDir, `${slug}${ENVELOPE_SUFFIX}`),
      {
        source,
        window,
        agency: {
          id: agencyId,
          name: agencyName,
          state: agencyState,
          county,
          place,
        },
        videos: inWindowVideos(cache.agencies[slug], window),
      },
    );
  };

  let quotaHit = false;
  try {
    let cursor: string | undefined;
    do {
      const page = await data.agencies({ minOfficers: 1, cursor, limit: 50 });
      for (const record of page.items) {
        await processAgency(
          record.agencyId,
          record.name.trim(),
          record.state,
          record.place ?? "",
          record.county ?? "",
        );
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);
  } catch (error) {
    if (!(error instanceof YoutubeQuotaError)) throw error;
    quotaHit = true;
    log.info(error.message);
  }

  log.info(
    `${SOURCE_ID}: channel ${channelId}, window ${window.start}..${window.end} — ` +
      `${backfilled} agency-year(s) backfilled, ${refreshed} refreshed, ${failed} skipped after errors` +
      `${quotaHit ? ", stopped on quota" : ""}. state=${state}`,
  );
};
