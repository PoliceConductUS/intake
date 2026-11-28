import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Per-agency, per-year search cache: a run searches one year per agency, so
// re-runs backfill older years one at a time (gentle on the YouTube search quota).
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

// The newest year in [floorYear, currentYear] this agency has never searched.
// When every year is searched: the year least recently searched among those
// last searched before the year ended, or null when there is none.
export function nextYearToAcquire(
  entry: AgencyVideoCacheEntry | undefined,
  floorYear: number,
  currentYear: number,
): number | null {
  let stale: { year: number; searchedAt: string } | null = null;
  for (let year = currentYear; year >= floorYear; year -= 1) {
    const cached = entry?.years[String(year)];
    if (cached === undefined) return year;
    if (
      cached.searchedAt < `${year + 1}-01-01T00:00:00.000Z` &&
      (stale === null || cached.searchedAt < stale.searchedAt)
    ) {
      stale = { year, searchedAt: cached.searchedAt };
    }
  }
  return stale === null ? null : stale.year;
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
