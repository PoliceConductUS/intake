import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Per-agency, per-year search cache. A run does at most one YouTube search per
// agency per year, so re-runs resume where the quota ran out instead of starting
// over, and a five-year backfill accumulates across runs.
//
// This source schedules differently from a fixed-floor backfill, because its
// window ROLLS: the newest year keeps gaining uploads after we search it, and the
// oldest year keeps falling out the back. Two schedules fall out of that, and
// acquire runs them in order so the second can never starve the first:
//
//   1. backfill — a year inside the window never searched at all
//   2. refresh  — a year searched before that year had ended, so uploads
//                 published after the search are still missing
//
// A year searched after it ended is final: nothing can be added to a past year.
// That is why there is no staleness interval to tune — "was the year over when we
// looked?" answers it exactly.
export const CACHE_FILE = "video-cache.json";

export type AcquiredVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  url: string;
  captions: string | null;
  /** When this source observed the video — link provenance, kept in the archive. */
  retrievedAt: string;
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

function cachedYears(entry: AgencyVideoCacheEntry | undefined): Set<number> {
  return new Set(
    Object.keys(entry?.years ?? {})
      .map(Number)
      .filter((year) => Number.isFinite(year)),
  );
}

/** The instant a calendar year ends (exclusive), in UTC. */
function yearEnd(year: number): number {
  return Date.UTC(year + 1, 0, 1);
}

/**
 * The newest year in `[floorYear, currentYear]` this agency has never been
 * searched for, or null when the window is fully backfilled. Newest first, so the
 * most useful coverage lands before the oldest.
 */
export function nextBackfillYear(
  entry: AgencyVideoCacheEntry | undefined,
  floorYear: number,
  currentYear: number,
): number | null {
  const cached = cachedYears(entry);
  for (let year = currentYear; year >= floorYear; year -= 1) {
    if (!cached.has(year)) return year;
  }
  return null;
}

/**
 * The newest year in `[floorYear, currentYear]` that was searched *before that
 * year had ended* — so uploads published after the search are still missing — or
 * null when every cached year in the window is final.
 *
 * The current year is always refreshable by this rule, which is the point: it is
 * how a video published today is picked up tomorrow.
 */
export function nextRefreshYear(
  entry: AgencyVideoCacheEntry | undefined,
  floorYear: number,
  currentYear: number,
): number | null {
  for (let year = currentYear; year >= floorYear; year -= 1) {
    const cached = entry?.years[String(year)];
    if (cached === undefined) continue;
    const searchedAt = new Date(cached.searchedAt).getTime();
    // An unparseable stamp is treated as "searched at the dawn of time", i.e.
    // refreshable — the safe direction is to look again, not to trust it.
    const complete = Number.isFinite(searchedAt) && searchedAt >= yearEnd(year);
    if (!complete) return year;
  }
  return null;
}

/**
 * The entry with cached years that have fallen out of the window dropped, so the
 * archive does not grow without bound and videos that aged out stop being
 * republished. `floorYear` itself is KEPT even though the window covers only part
 * of it — the precise per-video date filter runs at transform time.
 */
export function prunedEntry(
  entry: AgencyVideoCacheEntry | undefined,
  floorYear: number,
): { entry: AgencyVideoCacheEntry; droppedYears: number[] } {
  const years: AgencyVideoCacheEntry["years"] = {};
  const droppedYears: number[] = [];
  for (const [key, value] of Object.entries(entry?.years ?? {})) {
    const year = Number(key);
    if (Number.isFinite(year) && year >= floorYear) years[key] = value;
    else droppedYears.push(year);
  }
  return { entry: { years }, droppedYears: droppedYears.sort((a, b) => a - b) };
}

/**
 * Every cached year's videos for an agency, de-duplicated by videoId and ordered
 * by videoId so the written envelope is byte-stable across runs. Newer cached
 * years win a duplicate, since a refresh sees the video's current metadata.
 */
export function mergedVideos(
  entry: AgencyVideoCacheEntry | undefined,
): AcquiredVideo[] {
  const byId = new Map<string, AcquiredVideo>();
  const years = Object.keys(entry?.years ?? {}).sort(
    (a, b) => Number(b) - Number(a),
  );
  for (const year of years) {
    for (const video of entry?.years[year]?.videos ?? []) {
      if (!byId.has(video.videoId)) byId.set(video.videoId, video);
    }
  }
  return [...byId.values()].sort((a, b) => a.videoId.localeCompare(b.videoId));
}
