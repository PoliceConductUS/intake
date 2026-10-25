import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/transform/source-transform.js";
import { slugify } from "../lib/civil-defendants.js";
import {
  createYoutubeApi,
  isQuotaExhaustedBody,
  quotaResetHint,
  YoutubeQuotaError,
} from "../lib/youtube.js";
import {
  CHANNEL_HANDLE,
  CHANNEL_ID,
  SOURCE_ID,
  WINDOW_YEARS,
  runClock,
  windowFloorYear,
  windowStart,
} from "./channel.js";
import {
  loadVideoCache,
  mergedVideos,
  nextBackfillYear,
  nextRefreshYear,
  prunedEntry,
  saveVideoCache,
  type AcquiredVideo,
  type AgencyVideoCacheEntry,
} from "./video-cache.js";

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
  const fetchText = async (url: string): Promise<string> => {
    const response = await fetch(url);
    return response.ok ? response.text() : "";
  };

  const youtube = createYoutubeApi({ fetchJson, fetchText });

  // Identity: the handle must still resolve to the pinned channel id. If it does
  // not, the handle has moved and continuing would ingest a different channel's
  // uploads under this source's name — so the run stops.
  const resolvedId = await youtube.resolveChannelId(CHANNEL_HANDLE);
  if (resolvedId !== CHANNEL_ID) {
    throw new Error(
      `${SOURCE_ID}: ${CHANNEL_HANDLE} resolves to ${resolvedId ?? "no channel"}, not the pinned ${CHANNEL_ID}. ` +
        `Refusing to acquire: the handle may have been renamed or re-registered. Re-verify the channel before re-pinning.`,
    );
  }

  const now = runClock(env);
  const currentYear = now.getUTCFullYear();
  const floorYear = windowFloorYear(now);
  const acquiredAt = now.toISOString();

  await writeFile(
    path.join(sourceDir, "channel.json"),
    JSON.stringify(
      {
        handle: CHANNEL_HANDLE,
        channelId: CHANNEL_ID,
        pinned: true,
        handleResolvedTo: resolvedId,
        acquiredAt,
        window: {
          years: WINDOW_YEARS,
          start: windowStart(now).toISOString(),
          end: acquiredAt,
        },
      },
      null,
      2,
    ),
  );

  const cache = await loadVideoCache(state);
  let searched = 0;
  let refreshed = 0;
  let upToDate = 0;
  let failed = 0;
  let pruned = 0;

  const searchAgencyYear = async (
    slug: string,
    entry: AgencyVideoCacheEntry,
    agencyName: string,
    place: string,
    year: number,
  ): Promise<boolean> => {
    try {
      const hits = await youtube.searchChannelVideos(
        CHANNEL_ID,
        agencyQuery(agencyName, place),
        {
          publishedAfter: `${year}-01-01T00:00:00Z`,
          publishedBefore: `${year + 1}-01-01T00:00:00Z`,
        },
      );
      const videos: AcquiredVideo[] = [];
      for (const hit of hits) {
        // Defence in depth: the search is already channel-scoped, but a hit that
        // claims a different channel never enters the archive.
        if (hit.channelId !== CHANNEL_ID) {
          log.info(
            `${SOURCE_ID}: dropped ${hit.videoId} — channelId ${hit.channelId} is not the pinned channel.`,
          );
          continue;
        }
        videos.push({
          ...hit,
          captions: await youtube.fetchCaptions(hit.videoId),
          retrievedAt: new Date().toISOString(),
        });
      }
      entry.years[String(year)] = {
        searchedAt: new Date().toISOString(),
        videos,
      };
      cache.agencies[slug] = entry;
      await saveVideoCache(state, cache);
      log.info(
        `${SOURCE_ID}: ${agencyName} ${year} — ${videos.length} video(s)`,
      );
      await sleep(POLITE_DELAY_MS);
      return true;
    } catch (error) {
      // Quota exhausted halts the whole run (every later call would 403 too);
      // any other single-agency failure is logged and skipped, uncached so a
      // later run retries it.
      if (error instanceof YoutubeQuotaError) throw error;
      failed += 1;
      log.info(
        `${SOURCE_ID}: ${agencyName} ${year} — search failed, skipped (${error instanceof Error ? error.message : String(error)}).`,
      );
      return false;
    }
  };

  const writeEnvelope = async (
    slug: string,
    entry: AgencyVideoCacheEntry,
    agency: {
      id: string;
      name: string;
      state: string;
      county: string;
      place: string;
    },
  ): Promise<void> => {
    await writeFile(
      path.join(sourceDir, `${slug}.videos.json`),
      JSON.stringify(
        {
          agency,
          channelId: CHANNEL_ID,
          sourceName: SOURCE_ID,
          acquiredAt,
          window: {
            years: WINDOW_YEARS,
            start: windowStart(now).toISOString(),
            end: acquiredAt,
          },
          videos: mergedVideos(entry),
        },
        null,
        2,
      ),
    );
  };

  // `pass` is the schedule: backfill first across every agency, then refresh with
  // whatever quota is left. Refresh can therefore never starve an agency that has
  // not been searched even once — the opposite order would spend the daily quota
  // re-checking the current year for the agencies that page first.
  const processAgency = async (
    record: {
      agencyId: string;
      name: string;
      state: string;
      county: string | null;
      place: string | null;
    },
    pass: "backfill" | "refresh",
  ): Promise<void> => {
    const agencyName = record.name.trim();
    if (agencyName === "") return;
    const slug = slugify(agencyName);
    const place = record.place ?? "";

    const { entry, droppedYears } = prunedEntry(
      cache.agencies[slug],
      floorYear,
    );
    if (droppedYears.length > 0) {
      pruned += droppedYears.length;
      log.info(
        `${SOURCE_ID}: ${agencyName} — dropped ${droppedYears.join(", ")} (outside the ${WINDOW_YEARS}-year window).`,
      );
    }
    cache.agencies[slug] = entry;

    const year =
      pass === "backfill"
        ? nextBackfillYear(entry, floorYear, currentYear)
        : nextRefreshYear(entry, floorYear, currentYear);

    if (year === null) {
      if (pass === "backfill") upToDate += 1;
    } else if (await searchAgencyYear(slug, entry, agencyName, place, year)) {
      if (pass === "backfill") searched += 1;
      else refreshed += 1;
    }

    await writeEnvelope(slug, entry, {
      id: record.agencyId,
      name: agencyName,
      state: record.state,
      county: record.county ?? "",
      place,
    });
  };

  let quotaHit = false;
  try {
    for (const pass of ["backfill", "refresh"] as const) {
      let cursor: string | undefined;
      do {
        const page = await data.agencies({ minOfficers: 1, cursor, limit: 50 });
        for (const record of page.items) await processAgency(record, pass);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
    }
  } catch (error) {
    if (!(error instanceof YoutubeQuotaError)) throw error;
    quotaHit = true;
    log.info(error.message);
  }

  log.info(
    `${SOURCE_ID}: ${searched} agency-year(s) backfilled, ${refreshed} refreshed, ` +
      `${upToDate} already covering ${floorYear}..${currentYear}, ${pruned} aged-out year(s) dropped, ` +
      `${failed} skipped after errors${quotaHit ? ", stopped on quota" : ""}. state=${state}`,
  );
};
