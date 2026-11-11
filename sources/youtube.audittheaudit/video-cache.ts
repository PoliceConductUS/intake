// Per-agency, per-year search cache. A run does one search call per agency, so
// re-runs backfill one older year at a time (gentle on the YouTube search quota)
// and, once an agency is backfilled across the window, refresh the open year —
// the only year that can still gain videos.
//
// The cache is keyed by the agency's namespace-local source id, not its name:
// two agencies in different states share a name often enough that a name key
// would attribute one agency's videos to the other.
//
// Keeping every in-window video cached is what makes a skipped video
// reconsidered: a video with no resolvable officer today stays in the cache and
// is re-resolved on every later run, for as long as it is inside the window.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { windowYears, type RollingWindow } from "./rolling-window.js";

export const CACHE_FILE = "video-cache.json";

export type AcquiredVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  url: string;
};

export type AgencyVideoCacheEntry = {
  years: Record<string, { searchedAt: string; videos: AcquiredVideo[] }>;
};

export type VideoCache = {
  agencies: Record<string, AgencyVideoCacheEntry>;
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

/**
 * Drop every cached year the window has rolled past. Those years can no longer
 * contribute a qualifying video, and keeping them would make the cache grow
 * without bound.
 */
export function pruneToWindow(
  cache: VideoCache,
  window: RollingWindow,
): VideoCache {
  const inWindow = new Set(windowYears(window).map(String));
  const agencies: Record<string, AgencyVideoCacheEntry> = {};
  for (const [agencyId, entry] of Object.entries(cache.agencies)) {
    const years = Object.fromEntries(
      Object.entries(entry.years).filter(([year]) => inWindow.has(year)),
    );
    agencies[agencyId] = { years };
  }
  return { agencies };
}

/**
 * The year this agency's next search covers: the newest window year it has never
 * been searched for, or — once every window year is searched — the open year,
 * which is re-searched each run to pick up new uploads.
 */
export function nextYearToAcquire(
  entry: AgencyVideoCacheEntry | undefined,
  window: RollingWindow,
): number {
  const years = windowYears(window);
  for (const year of years) {
    if (entry === undefined || entry.years[String(year)] === undefined) {
      return year;
    }
  }
  return years[0];
}

/** Every cached year's videos for an agency, de-duplicated by videoId. */
export function mergedVideos(
  entry: AgencyVideoCacheEntry | undefined,
): AcquiredVideo[] {
  const byId = new Map<string, AcquiredVideo>();
  for (const year of Object.values(entry?.years ?? {})) {
    for (const video of year.videos) {
      if (!byId.has(video.videoId)) byId.set(video.videoId, video);
    }
  }
  return [...byId.values()];
}
