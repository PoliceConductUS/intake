import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AcquireDeps,
  SourceAcquire,
} from "../../src/cli/run/source-run.js";
import { slugify } from "../lib/civil-defendants.js";
import { createYoutubeApi, type AcquiredVideo } from "../lib/youtube.js";
import {
  agencyNeedsSearch,
  loadVideoCache,
  REFRESH_DAYS,
  saveVideoCache,
} from "./video-cache.js";

// The PoliceActivity channel (#64). Identity is the immutable channel id resolved
// from this handle at acquire time (#52).
const CHANNEL_HANDLE = "@PoliceActivity";
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 60_000;

// The channel search query for an agency: its name plus, when present, its place,
// so the channel search is scoped to that agency.
function agencyQuery(name: string, place: string): string {
  return [name, place]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
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
      // Log with the key redacted so raw evidence never carries the secret.
      await appendFile(
        apiLogPath,
        `${JSON.stringify({ at: new Date().toISOString(), url, status: response.status, body })}\n`,
      );
      if (response.ok) return body as Record<string, unknown>;
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
      await new Promise((resolve) => setTimeout(resolve, waitMs));
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

  const cache = await loadVideoCache(state);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let searched = 0;
  let cached = 0;
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

    let videos: AcquiredVideo[];
    if (agencyNeedsSearch(cache.agencies[slug], nowMs)) {
      try {
        const hits = await youtube.searchChannelVideos(
          channelId,
          agencyQuery(agencyName, place),
        );
        videos = [];
        for (const hit of hits) {
          videos.push({
            ...hit,
            captions: await youtube.fetchCaptions(hit.videoId),
          });
        }
      } catch (error) {
        // One agency's search failing must not abort the whole run — log and
        // skip, leaving it uncached so a later run retries it.
        failed += 1;
        log.info(
          `youtube.policeactivity: ${agencyName} — search failed, skipped (${error instanceof Error ? error.message : String(error)}).`,
        );
        return;
      }
      cache.agencies[slug] = { lastSearchedAt: nowIso, videos };
      await saveVideoCache(state, cache);
      searched += 1;
      log.info(
        `youtube.policeactivity: ${agencyName} — ${videos.length} video(s) [searched ${searched}]`,
      );
    } else {
      videos = cache.agencies[slug].videos;
      cached += 1;
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
          videos,
        },
        null,
        2,
      ),
    );
  };

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

  log.info(
    `youtube.policeactivity: ${searched} agencies searched, ${cached} served from cache (< ${REFRESH_DAYS} days), ${failed} skipped after errors. state=${state}`,
  );
};
