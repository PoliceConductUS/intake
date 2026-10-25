import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/transform/source-transform.js";
import { slugify } from "../lib/civil-defendants.js";
import { createDataApiFetch } from "../lib/youtube-data-api-fetch.js";
import { createYoutubeApi, YoutubeQuotaError } from "../lib/youtube.js";
import { CHANNEL_HANDLE, CHANNEL_ID, SOURCE_ID } from "./channel.js";
import { rollingWindow, yearSearchWindow } from "./rolling-window.js";
import {
  loadVideoCache,
  mergedVideos,
  nextYearToAcquire,
  pruneToWindow,
  saveVideoCache,
  type AcquiredVideo,
} from "./video-cache.js";

// Be gentle: a small pause between agency searches (we are in no rush).
const POLITE_DELAY_MS = 250;

export const description =
  "Audit the Audit (YouTube) — acquire searches the channel per agency over the rolling five-year period ending at the run, storing each hit's Data API snippet stamped with the agency's source id. No video media is downloaded.";

function agencyQuery(name: string, place: string): string {
  return [name, place]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

// The agency's source id makes the evidence file unique (two agencies can share
// a name); the slug keeps it readable.
function envelopeName(agencyName: string, agencyId: string): string {
  return `${slugify(agencyName)}.${agencyId.replace(/[^A-Za-z0-9._-]+/g, "-")}.videos.json`;
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

  const youtube = createYoutubeApi({
    fetchJson: createDataApiFetch({
      sourceId: SOURCE_ID,
      apiKey,
      apiLogPath: path.join(sourceDir, ".api-calls.jsonl"),
      logger: log,
    }),
    // This source reads no captions: the timedtext track lives under `/api/`,
    // which youtube.com/robots.txt disallows. Refused outright rather than
    // merely left uncalled, so it cannot be reached by accident.
    fetchText: () => {
      throw new Error(
        `${SOURCE_ID}: caption access is not permitted (youtube.com/robots.txt disallows /api/).`,
      );
    },
  });

  // The handle is re-resolved every run and must still answer with the channel id
  // this source is pinned to. A different id means the handle moved or the channel
  // was replaced — a human decides what that means, so the run stops.
  const resolvedChannelId = await youtube.resolveChannelId(CHANNEL_HANDLE);
  if (resolvedChannelId !== CHANNEL_ID) {
    throw new Error(
      `${SOURCE_ID}: ${CHANNEL_HANDLE} resolves to ${resolvedChannelId ?? "no channel"}, not the configured channel id ${CHANNEL_ID}.`,
    );
  }

  const window = rollingWindow(new Date());
  const retrievedAt = window.endsAt;
  await writeFile(
    path.join(sourceDir, "channel.json"),
    JSON.stringify(
      {
        handle: CHANNEL_HANDLE,
        channelId: CHANNEL_ID,
        window,
        retrievedAt,
      },
      null,
      2,
    ),
  );

  const cache = pruneToWindow(await loadVideoCache(state), window);
  let searched = 0;
  let failed = 0;

  const processAgency = async (agency: {
    id: string;
    name: string;
    state: string;
    county: string;
    place: string;
  }): Promise<void> => {
    if (agency.name === "") return;
    const entry = cache.agencies[agency.id] ?? { years: {} };
    const year = nextYearToAcquire(cache.agencies[agency.id], window);

    try {
      const hits = await youtube.searchChannelVideos(
        CHANNEL_ID,
        agencyQuery(agency.name, agency.place),
        yearSearchWindow(year, window),
      );
      const videos: AcquiredVideo[] = hits.map((hit) => {
        if (hit.channelId !== CHANNEL_ID) {
          throw new Error(
            `${SOURCE_ID}: search returned video ${hit.videoId} from channel ${hit.channelId}, not ${CHANNEL_ID}.`,
          );
        }
        return {
          videoId: hit.videoId,
          title: hit.title,
          description: hit.description,
          publishedAt: hit.publishedAt,
          channelId: hit.channelId,
          url: hit.url,
        };
      });
      entry.years[String(year)] = { searchedAt: retrievedAt, videos };
      cache.agencies[agency.id] = entry;
      await saveVideoCache(state, cache);
      searched += 1;
      log.info(
        `${SOURCE_ID}: ${agency.name} ${year} — ${videos.length} video(s) [searched ${searched}]`,
      );
      await sleep(POLITE_DELAY_MS);
    } catch (error) {
      // Quota exhausted halts the whole run (every later call would 403 too); any
      // other single-agency failure is logged and skipped, uncached so a later run
      // retries it.
      if (error instanceof YoutubeQuotaError) throw error;
      failed += 1;
      log.info(
        `${SOURCE_ID}: ${agency.name} ${year} — search failed, skipped (${error instanceof Error ? error.message : String(error)}).`,
      );
      return;
    }

    await writeFile(
      path.join(sourceDir, envelopeName(agency.name, agency.id)),
      JSON.stringify(
        {
          agency: {
            id: agency.id,
            name: agency.name,
            state: agency.state,
            county: agency.county,
            place: agency.place,
          },
          channel: { id: CHANNEL_ID, handle: CHANNEL_HANDLE },
          window,
          retrievedAt,
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
        await processAgency({
          id: record.agencyId,
          name: record.name.trim(),
          state: record.state,
          county: record.county ?? "",
          place: record.place ?? "",
        });
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);
  } catch (error) {
    if (!(error instanceof YoutubeQuotaError)) throw error;
    quotaHit = true;
    log.info(error.message);
  }

  log.info(
    `${SOURCE_ID}: ${searched} agency-year(s) searched in ${window.startsAt}..${window.endsAt}, ${failed} skipped after errors${quotaHit ? ", stopped on quota" : ""}. state=${state}`,
  );
};
