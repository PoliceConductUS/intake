import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";
import { slugify } from "../lib/civil-defendants.js";
import {
  createYoutubeApi,
  isQuotaExhaustedBody,
  YoutubeQuotaError,
} from "../lib/youtube.js";
import {
  loadVideoCache,
  mergedVideos,
  nextYearToAcquire,
  saveVideoCache,
  type AcquiredVideo,
} from "./video-cache.js";

const CHANNEL_HANDLE = "@PoliceActivity";
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
      "youtube.policeactivity: YOUTUBE_API_KEY is required to search the channel.",
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
        apiLogPath,
        `${JSON.stringify({ at: new Date().toISOString(), url, status: response.status, body })}\n`,
      );
      if (response.ok) return body as Record<string, unknown>;
      if (response.status === 403 && isQuotaExhaustedBody(body)) {
        throw new YoutubeQuotaError(
          "youtube.policeactivity: YouTube daily quota exhausted; stopping (resumes next run).",
        );
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        throw new Error(
          `youtube.policeactivity: ${response.status} for ${url}`,
        );
      }
      const waitMs = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
      log.info(
        `youtube.policeactivity: ${response.status}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES}).`,
      );
      await sleep(waitMs);
    }
  };
  const fetchText = async (url: string): Promise<string> => {
    const response = await fetch(url);
    return response.ok ? response.text() : "";
  };

  const youtube = createYoutubeApi({ fetchJson, fetchText });
  const channelId = await youtube.resolveChannelId(CHANNEL_HANDLE);
  if (channelId === null) {
    throw new Error(
      `youtube.policeactivity: could not resolve channel id for ${CHANNEL_HANDLE}.`,
    );
  }
  await writeFile(
    path.join(sourceDir, "channel.json"),
    JSON.stringify({ handle: CHANNEL_HANDLE, channelId }, null, 2),
  );

  // Backfill window: the current year by default; prod widens it (e.g. 5 years)
  // via YOUTUBE_MIN_YEAR. Each run fetches one agency-year, newest first.
  const currentYear = new Date().getFullYear();
  const floorYear = Number(env.YOUTUBE_MIN_YEAR ?? currentYear);

  const cache = await loadVideoCache(state);
  const nowIso = new Date().toISOString();
  let searched = 0;
  let upToDate = 0;
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
    const entry = cache.agencies[slug] ?? { years: {} };

    const year = nextYearToAcquire(entry, floorYear, currentYear);
    if (year === null) {
      upToDate += 1;
    } else {
      try {
        const hits = await youtube.searchChannelVideos(
          channelId,
          agencyQuery(agencyName, place),
          {
            publishedAfter: `${year}-01-01T00:00:00Z`,
            publishedBefore: `${year + 1}-01-01T00:00:00Z`,
          },
        );
        const videos: AcquiredVideo[] = [];
        for (const hit of hits) {
          videos.push({
            ...hit,
            captions: await youtube.fetchCaptions(hit.videoId),
          });
        }
        entry.years[String(year)] = { searchedAt: nowIso, videos };
        cache.agencies[slug] = entry;
        await saveVideoCache(state, cache);
        searched += 1;
        log.info(
          `youtube.policeactivity: ${agencyName} ${year} — ${videos.length} video(s) [searched ${searched}]`,
        );
        await sleep(POLITE_DELAY_MS);
      } catch (error) {
        // Quota exhausted halts the whole run (every later call would 403 too);
        // any other single-agency failure is logged and skipped, uncached so a
        // later run retries it.
        if (error instanceof YoutubeQuotaError) throw error;
        failed += 1;
        log.info(
          `youtube.policeactivity: ${agencyName} ${year} — search failed, skipped (${error instanceof Error ? error.message : String(error)}).`,
        );
        return;
      }
    }

    await writeFile(
      path.join(sourceDir, `${slug}.videos.json`),
      JSON.stringify(
        {
          agency: {
            id: agencyId,
            name: agencyName,
            state: agencyState,
            county,
            place,
          },
          channelId,
          videos: mergedVideos(entry),
        },
        null,
        2,
      ),
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
    `youtube.policeactivity: ${searched} agency-years searched, ${upToDate} already backfilled to ${floorYear}, ${failed} skipped after errors${quotaHit ? ", stopped on quota" : ""}. state=${state}`,
  );
};
