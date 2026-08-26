import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Per-agency, per-year search cache: a run does one search call per agency for
// one year, so re-runs skip years already fetched and backfill older years one at
// a time (gentle on the YouTube search quota).
export const CACHE_FILE = "video-cache.json";

export type AcquiredVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  url: string;
  captions: string | null;
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

// The newest year in [floorYear, currentYear] this agency has not searched yet,
// or null when it is backfilled to the floor.
export function nextYearToAcquire(
  entry: AgencyVideoCacheEntry | undefined,
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
