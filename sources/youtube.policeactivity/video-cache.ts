import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isWithinWindow,
  type PublicationWindow,
} from "../lib/rolling-window.js";

// Per-agency, per-year search cache. A run does one search call per agency, so
// re-runs backfill the rolling window one year at a time (the YouTube search
// quota is ~100 calls/day against ~18k agencies) and then keep the window's end
// year fresh. The cache is this source's raw evidence: it is never pruned, and
// the window is applied when the evidence envelope is written.
export const CACHE_FILE = "video-cache.json";

export type AcquiredVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  url: string;
  retrievedAt: string;
};

export type AgencyVideoCacheEntry = {
  years: Record<string, { searchedAt: string; videos: AcquiredVideo[] }>;
};

export type VideoCache = {
  agencies: Record<string, AgencyVideoCacheEntry>;
};

/** One date-bounded channel search: the year it covers, clipped to the window. */
export type VideoSlice = {
  year: number;
  publishedAfter: string;
  publishedBefore: string;
  /** True when this year was already searched and is being re-searched. */
  refresh: boolean;
};

export async function loadVideoCache(stateDir: string): Promise<VideoCache> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(stateDir, CACHE_FILE), "utf8"),
    ) as VideoCache;
    return { agencies: parsed.agencies ?? {} };
  } catch {
    return { agencies: {} };
  }
}

export async function saveVideoCache(
  stateDir: string,
  cache: VideoCache,
): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, CACHE_FILE),
    JSON.stringify(cache, null, 2),
  );
}

function yearStart(year: number): string {
  return new Date(Date.UTC(year, 0, 1)).toISOString();
}

function later(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function earlier(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

/** Every calendar year the window touches, newest first. */
export function windowYears(window: PublicationWindow): number[] {
  const newest = new Date(window.end).getUTCFullYear();
  const oldest = new Date(window.start).getUTCFullYear();
  const years: number[] = [];
  for (let year = newest; year >= oldest; year -= 1) years.push(year);
  return years;
}

/**
 * The one slice a run searches for an agency: the newest year the window covers
 * that this agency has never been searched for (backfill, newest first), or —
 * once every covered year has been searched — the year the window ends in, which
 * is the only slice that can still gain videos. Bounds are clipped to the window,
 * so a video outside it is never even requested.
 */
export function nextSliceToSearch(
  entry: AgencyVideoCacheEntry | undefined,
  window: PublicationWindow,
): VideoSlice {
  const years = windowYears(window);
  const unsearched = years.find(
    (year) => entry?.years[String(year)] === undefined,
  );
  const year = unsearched ?? years[0];
  return {
    year,
    publishedAfter: later(yearStart(year), window.start),
    publishedBefore: earlier(yearStart(year + 1), window.end),
    refresh: unsearched === undefined,
  };
}

/**
 * The agency's cache with this slice's result recorded. The newest observation of
 * a video wins: a re-searched video whose title or description changed must reach
 * the coverage link as an update, and `retrievedAt` records when the link was
 * last seen live. A video the search no longer returns keeps its last observation
 * rather than disappearing from the evidence.
 */
export function recordSlice(
  entry: AgencyVideoCacheEntry | undefined,
  slice: VideoSlice,
  searchedAt: string,
  videos: readonly AcquiredVideo[],
): AgencyVideoCacheEntry {
  const key = String(slice.year);
  const merged = new Map<string, AcquiredVideo>(
    (entry?.years[key]?.videos ?? []).map((video) => [video.videoId, video]),
  );
  for (const video of videos) merged.set(video.videoId, video);
  return {
    years: {
      ...(entry?.years ?? {}),
      [key]: { searchedAt, videos: [...merged.values()] },
    },
  };
}

/**
 * Every cached video for an agency that the window covers, de-duplicated by
 * videoId (newest retrieval wins) and ordered newest-published first so the
 * evidence envelope is stable across runs.
 */
export function inWindowVideos(
  entry: AgencyVideoCacheEntry | undefined,
  window: PublicationWindow,
): AcquiredVideo[] {
  const byId = new Map<string, AcquiredVideo>();
  for (const year of Object.values(entry?.years ?? {})) {
    for (const video of year.videos) {
      if (!isWithinWindow(video.publishedAt, window)) continue;
      const seen = byId.get(video.videoId);
      if (
        seen === undefined ||
        Date.parse(video.retrievedAt) >= Date.parse(seen.retrievedAt)
      ) {
        byId.set(video.videoId, video);
      }
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
      left.videoId.localeCompare(right.videoId),
  );
}
