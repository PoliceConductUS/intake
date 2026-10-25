import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/transform/source-transform.js";
import { slugify } from "../lib/civil-defendants.js";
import {
  createKeyedYoutubeFetchers,
  createYoutubeApi,
  YoutubeQuotaError,
  type YoutubeApi,
} from "../lib/youtube.js";
import {
  loadVideoCache,
  mergedVideos,
  saveVideoCache,
} from "../lib/youtube-video-cache.js";
import {
  agedOutYears,
  CHANNEL_HANDLE,
  CHANNEL_ID,
  isInWindow,
  publicationWindow,
  searchWindowForYear,
  SOURCE_ID,
  windowFloorYear,
  yearToSearch,
  type PublicationWindow,
} from "./channel.js";
import type { AcquiredVideo } from "./transform.js";

// Be gentle: a small pause between agency searches (we are in no rush).
const POLITE_DELAY_MS = 250;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function agencyQuery(name: string, place: string): string {
  return [name, place]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Verify the pinned channel id still names a live channel and capture its
 * mutable handle/title as provenance. Selection is by id, so a renamed or
 * transferred handle cannot silently redirect this source at another channel; a
 * drifted handle is logged, never followed.
 */
async function verifiedChannel(
  youtube: YoutubeApi,
  log: { info: (message: string) => void },
): Promise<{ channelId: string; handle: string; title: string }> {
  const channel = await youtube.fetchChannelById(CHANNEL_ID);
  if (channel === null) {
    throw new Error(
      `${SOURCE_ID}: pinned channel id ${CHANNEL_ID} (${CHANNEL_HANDLE}) resolves to no channel.`,
    );
  }
  if (channel.channelId !== CHANNEL_ID) {
    throw new Error(
      `${SOURCE_ID}: channels.list returned ${channel.channelId} for pinned id ${CHANNEL_ID}.`,
    );
  }
  const handle = channel.handle.toLowerCase();
  if (handle !== "" && handle !== CHANNEL_HANDLE.toLowerCase()) {
    log.info(
      `${SOURCE_ID}: channel ${CHANNEL_ID} now publishes as ${channel.handle} (expected ${CHANNEL_HANDLE}); keeping the pinned id.`,
    );
  }
  return channel;
}

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

  const { fetchJson, fetchText } = createKeyedYoutubeFetchers({
    sourceId: SOURCE_ID,
    apiKey,
    apiLogPath: path.join(sourceDir, ".api-calls.jsonl"),
    logger: log,
  });
  const youtube = createYoutubeApi({ fetchJson, fetchText });
  const channel = await verifiedChannel(youtube, log);
  await writeFile(
    path.join(sourceDir, "channel.json"),
    JSON.stringify(channel, null, 2),
  );

  // The window is a function of this run's clock, so it is decided here — the
  // transform phase must stay deterministic and never read the clock. It is
  // recorded in every envelope, and only in-window videos are written there, so
  // the transform needs no window logic of its own.
  const now = new Date();
  const window: PublicationWindow = publicationWindow(now);
  const floorYear = windowFloorYear(window);
  const currentYear = now.getUTCFullYear();
  const nowIso = now.toISOString();
  log.info(
    `${SOURCE_ID}: window ${window.from} … ${window.to} (${floorYear}–${currentYear}).`,
  );

  const cache = await loadVideoCache<AcquiredVideo>(state);
  let searched = 0;
  let failed = 0;
  let pruned = 0;

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

    // Drop whole years that have aged out of the rolling window; they can no
    // longer produce a link, and keeping them would quietly widen the window.
    for (const year of agedOutYears(entry, window)) {
      delete entry.years[year];
      pruned += 1;
    }

    const year = yearToSearch(entry, floorYear, currentYear);
    try {
      const hits = await youtube.searchChannelVideos(
        channel.channelId,
        agencyQuery(agencyName, place),
        searchWindowForYear(year, window),
      );
      // Merge rather than replace: one search returns at most 50 hits, so a
      // re-search of the still-open current year must not drop a video an
      // earlier run saw — it is still inside the window and must keep being
      // reconsidered.
      const byId = new Map(
        (entry.years[String(year)]?.videos ?? []).map((video) => [
          video.videoId,
          video,
        ]),
      );
      for (const hit of hits) {
        byId.set(hit.videoId, { ...hit, retrievedAt: nowIso });
      }
      entry.years[String(year)] = {
        searchedAt: nowIso,
        videos: [...byId.values()],
      };
      cache.agencies[slug] = entry;
      await saveVideoCache(state, cache);
      searched += 1;
      log.info(
        `${SOURCE_ID}: ${agencyName} ${year} — ${hits.length} hit(s) [searched ${searched}]`,
      );
      await sleep(POLITE_DELAY_MS);
    } catch (error) {
      // Quota exhausted halts the whole run (every later call would 403 too);
      // any other single-agency failure is logged and skipped, uncached so a
      // later run retries it.
      if (error instanceof YoutubeQuotaError) throw error;
      failed += 1;
      log.info(
        `${SOURCE_ID}: ${agencyName} ${year} — search failed, skipped (${error instanceof Error ? error.message : String(error)}).`,
      );
      return;
    }

    // Every run re-writes the envelope from the full in-window cache, so a video
    // that matched no officer last run is handed to the transform again and links
    // itself as soon as the officer exists.
    const videos = mergedVideos(entry).filter((video) =>
      isInWindow(video.publishedAt, window),
    );
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
          channel,
          window,
          retrievedAt: nowIso,
          videos,
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
    `${SOURCE_ID}: ${searched} agency-year(s) searched, ${pruned} aged-out year(s) pruned, ${failed} skipped after errors${quotaHit ? ", stopped on quota" : ""}. state=${state}`,
  );
};
