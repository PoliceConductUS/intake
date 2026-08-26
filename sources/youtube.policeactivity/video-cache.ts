import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// A per-agency search cache so a re-run does not re-spend YouTube search quota on
// agencies searched within the refresh window (mirrors courtlistener's
// docket-cache). Keyed by agency slug.
export const CACHE_FILE = "video-cache.json";
export const REFRESH_DAYS = 30;

export type AcquiredVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  url: string;
  // Caption text, or null when the video has no available captions (provenance
  // is part of video identity, #52).
  captions: string | null;
};

export type AgencyVideoCacheEntry = {
  lastSearchedAt: string;
  videos: AcquiredVideo[];
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

export function agencyNeedsSearch(
  entry: AgencyVideoCacheEntry | undefined,
  nowMs: number,
  refreshDays: number = REFRESH_DAYS,
): boolean {
  if (entry === undefined) return true;
  const lastMs = Date.parse(entry.lastSearchedAt);
  if (!Number.isFinite(lastMs)) return true;
  return (nowMs - lastMs) / 86_400_000 > refreshDays;
}
