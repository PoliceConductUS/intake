import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireAgencyRecord,
  AcquireDeps,
  SourceAcquire,
} from "../../../../src/cli/transform/source-transform.js";
import { rollingWindow } from "../../../lib/rolling-window.js";
import {
  createYoutubeApi,
  isQuotaExhaustedBody,
  quotaResetHint,
  YoutubeQuotaError,
} from "../../../lib/youtube.js";
import {
  CHANNEL_HANDLE,
  CHANNEL_URL,
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
  type AgencyVideoCacheEntry,
} from "./video-cache.js";
import { ENVELOPE_SUFFIX, writeVideoEnvelope } from "./video-envelope.js";

const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60_000;
// Be gentle: a small pause between agency searches (we are in no rush).
const POLITE_DELAY_MS = 250;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
      "com/youtube/policeactivity: YOUTUBE_API_KEY is required to search the channel.",
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
      if (response.ok) {
        if (typeof body !== "object" || body === null) {
          throw new Error(
            `com/youtube/policeactivity: ${response.status} for ${url} is not a JSON object.`,
          );
        }
        return body as Record<string, unknown>;
      }
      if (isQuotaExhaustedBody(body)) {
        throw new YoutubeQuotaError(
          `com/youtube/policeactivity: YouTube quota exhausted (${response.status}); ${quotaResetHint(body, new Date())}. Stopping (resumes next run).`,
        );
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        throw new Error(
          `com/youtube/policeactivity: ${response.status} for ${url}`,
        );
      }
      const waitMs = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
      log.info(
        `com/youtube/policeactivity: ${response.status}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES}).`,
      );
      await sleep(waitMs);
    }
  };
  const youtube = createYoutubeApi({ fetchJson });
  const channelId = await stableChannelId(state, youtube.resolveChannelId);
  // Fixed once so every search and envelope in this run shares one window.
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
  let notSearched = 0;
  let quotaHit = false;

  const agencies: AcquireAgencyRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await data.agencies({ minOfficers: 1, cursor, limit: 50 });
    for (const record of page.items) {
      if (record.name.trim() === "") {
        throw new Error(
          `com/youtube/policeactivity: agency ${record.agencyId} has a blank name.`,
        );
      }
      agencies.push(record);
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  // Under the search quota a run reaches only some agencies: a slice never
  // searched goes first, then the slices searched longest ago.
  const planned = agencies
    .map((agency) => {
      const entry: AgencyVideoCacheEntry | undefined =
        cache.agencies[agency.agencyId];
      const slice = nextSliceToSearch(entry, window);
      const lastSearchedAt = entry?.years[String(slice.year)]?.searchedAt ?? "";
      return { agency, slice, lastSearchedAt };
    })
    .sort((a, b) =>
      a.lastSearchedAt < b.lastSearchedAt
        ? -1
        : a.lastSearchedAt > b.lastSearchedAt
          ? 1
          : 0,
    );

  for (const { agency, slice } of planned) {
    const agencyName = agency.name.trim();
    const place = agency.place ?? "";
    const { year } = slice;
    let searchFailure: { year: number; error: string } | undefined;

    if (quotaHit) {
      notSearched += 1;
    } else {
      let searched: { at: string; videos: AcquiredVideo[] } | undefined;
      try {
        const hits = await youtube.searchChannelVideos(
          channelId,
          agencyQuery(agencyName, place),
          {
            publishedAfter: slice.publishedAfter,
            publishedBefore: slice.publishedBefore,
          },
        );
        const at = new Date().toISOString();
        searched = {
          at,
          videos: hits.map((hit) => ({ ...hit, retrievedAt: at })),
        };
      } catch (error) {
        // Quota exhausted stops every later search (each would fail the same
        // way); any other failure is one agency's, left uncached so a later run
        // retries it.
        searchFailure = { year, error: errorMessage(error) };
        if (error instanceof YoutubeQuotaError) {
          quotaHit = true;
          log.info(error.message);
        } else {
          failed += 1;
          log.info(
            `com/youtube/policeactivity: ${agencyName} (${agency.agencyId}) ${year} — search failed (${searchFailure.error}).`,
          );
        }
      }
      if (searched !== undefined) {
        cache.agencies[agency.agencyId] = recordSlice(
          cache.agencies[agency.agencyId],
          slice,
          searched.at,
          searched.videos,
        );
        await saveVideoCache(state, cache);
        if (slice.refresh) refreshed += 1;
        else backfilled += 1;
        log.info(
          `com/youtube/policeactivity: ${agencyName} (${agency.agencyId}) ${year}${slice.refresh ? " (refresh)" : ""} — ${searched.videos.length} video(s)`,
        );
        await sleep(POLITE_DELAY_MS);
      }
    }

    const entry = cache.agencies[agency.agencyId];
    if (entry === undefined || Object.keys(entry.years).length === 0) continue;
    await writeVideoEnvelope(
      path.join(
        sourceDir,
        `${encodeURIComponent(agency.agencyId)}${ENVELOPE_SUFFIX}`,
      ),
      {
        source,
        window,
        agency: {
          id: agency.agencyId,
          name: agencyName,
          state: agency.state,
          county: agency.county ?? "",
          place,
        },
        videos: inWindowVideos(entry, window),
        ...(searchFailure === undefined ? {} : { searchFailure }),
      },
    );
  }

  log.info(
    `com/youtube/policeactivity: channel ${channelId}, window ${window.start}..${window.end}: ${backfilled} agency-year(s) backfilled, ${refreshed} refreshed, ${failed} failed, ${notSearched} not searched after the quota stop${quotaHit ? ", stopped on quota" : ""}. state=${state}`,
  );
};
