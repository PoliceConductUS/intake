import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Per-agency, per-year search cache shared by the YouTube channel sources: a run
// does one search call per agency for one year, so re-runs skip years already
// fetched and backfill older years one at a time (gentle on the YouTube search
// quota). The cached video payload is each source's own shape.
export const CACHE_FILE = "video-cache.json";

export type AcquiredVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  url: string;
  /** When this video's metadata was retrieved from the API. */
  retrievedAt: string;
};

export type AgencyVideoCacheEntry<TVideo = AcquiredVideo> = {
  years: Record<string, { searchedAt: string; videos: TVideo[] }>;
};

export type VideoCache<TVideo = AcquiredVideo> = {
  agencies: Record<string, AgencyVideoCacheEntry<TVideo>>;
};

export async function loadVideoCache<TVideo = AcquiredVideo>(
  stateDir: string,
): Promise<VideoCache<TVideo>> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(stateDir, CACHE_FILE), "utf8"),
    ) as VideoCache<TVideo>;
    return { agencies: parsed.agencies ?? {} };
  } catch {
    return { agencies: {} };
  }
}

export async function saveVideoCache<TVideo>(
  stateDir: string,
  cache: VideoCache<TVideo>,
): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, CACHE_FILE),
    JSON.stringify(cache, null, 2),
  );
}

// The newest year in [floorYear, currentYear] this agency has not searched yet,
// or null when it is backfilled to the floor.
export function nextYearToAcquire<TVideo>(
  entry: AgencyVideoCacheEntry<TVideo> | undefined,
  floorYear: number,
  currentYear: number,
): number | null {
  for (let year = currentYear; year >= floorYear; year -= 1) {
    if (entry === undefined || entry.years[String(year)] === undefined) {
      return year;
    }
  }
  return null;
}

// Every cached year's videos for an agency, de-duplicated by videoId.
export function mergedVideos<TVideo extends { videoId: string }>(
  entry: AgencyVideoCacheEntry<TVideo> | undefined,
): TVideo[] {
  const byId = new Map<string, TVideo>();
  for (const year of Object.values(entry?.years ?? {})) {
    for (const video of year.videos) {
      if (!byId.has(video.videoId)) byId.set(video.videoId, video);
    }
  }
  return [...byId.values()];
}

const MS_PER_DAY = 86_400_000;

/**
 * The year this run should search for an agency, or null when it is current.
 *
 * The current year's bucket is never "done" — the channel keeps publishing into
 * it — so it is re-searched once its last search is older than `refreshDays`.
 * Otherwise the newest not-yet-searched older year in the window is backfilled,
 * newest first.
 */
export function planYearToAcquire(
  entry: AgencyVideoCacheEntry | undefined,
  options: {
    floorYear: number;
    currentYear: number;
    now: Date;
    refreshDays: number;
  },
): number | null {
  const { floorYear, currentYear, now, refreshDays } = options;
  const current = entry?.years[String(currentYear)];
  if (current === undefined) return currentYear;
  const searchedAt = Date.parse(current.searchedAt);
  const staleAfterMs = Math.max(0, refreshDays) * MS_PER_DAY;
  if (Number.isNaN(searchedAt) || now.getTime() - searchedAt >= staleAfterMs) {
    return currentYear;
  }
  for (let year = currentYear - 1; year >= floorYear; year -= 1) {
    if (entry?.years[String(year)] === undefined) return year;
  }
  return null;
}

/** The entry with buckets for years before `floorYear` dropped. */
export function pruneYearsBefore(
  entry: AgencyVideoCacheEntry,
  floorYear: number,
): AgencyVideoCacheEntry {
  const years: AgencyVideoCacheEntry["years"] = {};
  for (const [year, bucket] of Object.entries(entry.years)) {
    if (Number(year) >= floorYear) years[year] = bucket;
  }
  return { years };
}
