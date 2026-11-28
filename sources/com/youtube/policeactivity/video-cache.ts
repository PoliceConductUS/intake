import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isWithinWindow,
  type PublicationWindow,
} from "../../../lib/rolling-window.js";

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
  const file = path.join(stateDir, CACHE_FILE);
  let contents: string;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { agencies: {} };
    }
    throw error;
  }
  const parsed = JSON.parse(contents) as Partial<VideoCache> | null;
  if (typeof parsed?.agencies !== "object" || parsed.agencies === null) {
    throw new Error(`com/youtube/policeactivity: ${file} has no agencies.`);
  }
  return { agencies: parsed.agencies };
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
 * The one slice a run searches for an agency, clipped to the window so a video
 * outside it is never requested: the newest covered year this agency has never
 * been searched for; when every covered year is searched, the year searched
 * longest ago among those last searched before the year ended. The window's end
 * year always qualifies, so new uploads are picked up, and a past year is
 * searched once more after it ends.
 */
export function nextSliceToSearch(
  entry: AgencyVideoCacheEntry | undefined,
  window: PublicationWindow,
): VideoSlice {
  const years = windowYears(window);
  let chosen: { year: number; searchedAt: string } | undefined;
  for (const year of years) {
    const cached = entry?.years[String(year)];
    if (cached === undefined) return slice(year, window, false);
    if (
      Date.parse(cached.searchedAt) < Date.parse(yearStart(year + 1)) &&
      (chosen === undefined ||
        Date.parse(cached.searchedAt) < Date.parse(chosen.searchedAt))
    ) {
      chosen = { year, searchedAt: cached.searchedAt };
    }
  }
  if (chosen === undefined) {
    throw new Error(
      `com/youtube/policeactivity: every cached year was searched after the window ending ${window.end}; the cache is from a later clock.`,
    );
  }
  return slice(chosen.year, window, true);
}

function slice(
  year: number,
  window: PublicationWindow,
  refresh: boolean,
): VideoSlice {
  return {
    year,
    publishedAfter: later(yearStart(year), window.start),
    publishedBefore: earlier(yearStart(year + 1), window.end),
    refresh,
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
