import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireAgencyRecord,
  AcquireDeps,
  SourceAcquire,
} from "../../../../src/cli/transform/source-transform.js";
import {
  createYoutubeApi,
  isQuotaExhaustedBody,
  quotaResetHint,
  YoutubeQuotaError,
} from "../../../lib/youtube.js";
import {
  loadVideoCache,
  mergedVideos,
  nextYearToAcquire,
  saveVideoCache,
  type AcquiredVideo,
  type AgencyVideoCacheEntry,
} from "./video-cache.js";

const CHANNEL_HANDLE = "@PoliceActivity";
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
  // Backfill window: the current year by default; prod widens it (e.g. 5 years)
  // via YOUTUBE_MIN_YEAR. Each run searches one year per agency.
  const currentYear = new Date().getFullYear();
  const minYear = env.YOUTUBE_MIN_YEAR;
  const floorYear = minYear === undefined ? currentYear : Number(minYear);
  if (
    minYear !== undefined &&
    (minYear.trim() === "" || !Number.isInteger(floorYear))
  ) {
    throw new Error(
      `com/youtube/policeactivity: YOUTUBE_MIN_YEAR is not a year: ${JSON.stringify(minYear)}.`,
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
  const channelId = await youtube.resolveChannelId(CHANNEL_HANDLE);
  if (channelId === null) {
    throw new Error(
      `com/youtube/policeactivity: could not resolve channel id for ${CHANNEL_HANDLE}.`,
    );
  }
  await writeFile(
    path.join(sourceDir, "channel.json"),
    JSON.stringify({ handle: CHANNEL_HANDLE, channelId }, null, 2),
  );

  const cache = await loadVideoCache(state);
  const nowIso = new Date().toISOString();
  let searched = 0;
  let upToDate = 0;
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

  // Under the search quota a run reaches only some agencies: a year never
  // searched goes first, then the years searched longest ago.
  const planned = agencies
    .map((agency) => {
      const entry: AgencyVideoCacheEntry = cache.agencies[agency.agencyId] ?? {
        years: {},
      };
      const year = nextYearToAcquire(entry, floorYear, currentYear);
      const lastSearchedAt =
        year === null ? "" : (entry.years[String(year)]?.searchedAt ?? "");
      return { agency, entry, year, lastSearchedAt };
    })
    .sort((a, b) =>
      a.lastSearchedAt < b.lastSearchedAt
        ? -1
        : a.lastSearchedAt > b.lastSearchedAt
          ? 1
          : 0,
    );

  for (const { agency, entry, year } of planned) {
    const agencyName = agency.name.trim();
    const place = agency.place ?? "";
    let searchFailure: { year: number; error: string } | undefined;

    if (year === null) {
      upToDate += 1;
    } else if (quotaHit) {
      notSearched += 1;
    } else {
      let videos: AcquiredVideo[] | undefined;
      try {
        videos = await youtube.searchChannelVideos(
          channelId,
          agencyQuery(agencyName, place),
          {
            publishedAfter: `${year}-01-01T00:00:00Z`,
            publishedBefore: `${year + 1}-01-01T00:00:00Z`,
          },
        );
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
      if (videos !== undefined) {
        entry.years[String(year)] = { searchedAt: nowIso, videos };
        cache.agencies[agency.agencyId] = entry;
        await saveVideoCache(state, cache);
        searched += 1;
        log.info(
          `com/youtube/policeactivity: ${agencyName} (${agency.agencyId}) ${year} — ${videos.length} video(s) [searched ${searched}]`,
        );
        await sleep(POLITE_DELAY_MS);
      }
    }

    if (Object.keys(entry.years).length === 0) continue;
    await writeFile(
      path.join(
        sourceDir,
        `${encodeURIComponent(agency.agencyId)}.videos.json`,
      ),
      JSON.stringify(
        {
          agency: {
            id: agency.agencyId,
            name: agencyName,
            state: agency.state,
            county: agency.county ?? "",
            place,
          },
          channelId,
          videos: mergedVideos(entry),
          ...(searchFailure === undefined ? {} : { searchFailure }),
        },
        null,
        2,
      ),
    );
  }

  log.info(
    `com/youtube/policeactivity: ${searched} agency-years searched, ${upToDate} with no year to search from ${floorYear}, ${failed} failed, ${notSearched} not searched after the quota stop${quotaHit ? ", stopped on quota" : ""}. state=${state}`,
  );
};
