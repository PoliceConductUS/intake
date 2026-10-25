// Acquisition state for a YouTube channel coverage source: which agency-year
// chunks of the channel have been searched, and the videos each chunk returned.
//
// One search call costs 100 units against a 10,000/day default quota, so a run
// searches at most one agency-year per agency and backfills across many runs.
// This module holds the pure decisions that pacing needs — which year to search
// next, which agency is stalest, and what is still inside the rolling window —
// so they are testable without a network or a database.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const CACHE_FILE = "video-cache.json";

/** A link to a video and the provenance of that link. Never video media. */
export type AcquiredVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  url: string;
  captions: string | null;
  /** When this run retrieved the video from the channel. */
  retrievedAt: string;
};

/**
 * The publication window a run considers: `windowYears` back from the run
 * instant, to the run instant. Stamped into every envelope acquire writes so
 * the transform applies the window the evidence was gathered under rather than
 * the window at transform time.
 */
export type PublicationWindow = { start: string; end: string };

export type ChannelYearChunk = { searchedAt: string; videos: AcquiredVideo[] };
export type ChannelCacheEntry = { years: Record<string, ChannelYearChunk> };
export type ChannelCache = { agencies: Record<string, ChannelCacheEntry> };

/** The rolling window of `years` ending at `now`. */
export function rollingWindow(now: Date, years: number): PublicationWindow {
  const start = new Date(now.getTime());
  start.setUTCFullYear(start.getUTCFullYear() - years);
  return { start: start.toISOString(), end: now.toISOString() };
}

/** The calendar years the window touches, oldest and newest. */
export function windowYearRange(window: PublicationWindow): {
  floorYear: number;
  newestYear: number;
} {
  return {
    floorYear: new Date(window.start).getUTCFullYear(),
    newestYear: new Date(window.end).getUTCFullYear(),
  };
}

/**
 * The search bounds for one calendar year, clipped to the window — so the
 * oldest chunk starts at the window start and the newest ends at the run
 * instant, and no search ever reaches outside the window.
 */
export function searchBounds(
  year: number,
  window: PublicationWindow,
): { publishedAfter: string; publishedBefore: string } {
  const after = Math.max(Date.UTC(year, 0, 1), Date.parse(window.start));
  const before = Math.min(Date.UTC(year + 1, 0, 1), Date.parse(window.end));
  return {
    publishedAfter: new Date(after).toISOString(),
    publishedBefore: new Date(before).toISOString(),
  };
}

/**
 * The year chunk to search for an agency this run: the newest window year it has
 * never searched, so the backfill finishes first; once every window year is
 * cached, the newest year, which is still accumulating uploads.
 */
export function nextYearToAcquire(
  entry: ChannelCacheEntry | undefined,
  floorYear: number,
  newestYear: number,
): number {
  for (let year = newestYear; year >= floorYear; year -= 1) {
    if (entry?.years[String(year)] === undefined) return year;
  }
  return newestYear;
}

/**
 * When this agency was last searched, or `""` when never — which sorts before
 * every ISO timestamp, so never-searched agencies come first in a stalest-first
 * ordering.
 */
export function lastSearchedAt(entry: ChannelCacheEntry | undefined): string {
  let latest = "";
  for (const chunk of Object.values(entry?.years ?? {})) {
    if (chunk.searchedAt > latest) latest = chunk.searchedAt;
  }
  return latest;
}

/** Every cached year's videos for an agency, de-duplicated by videoId. */
export function mergedVideos(
  entry: ChannelCacheEntry | undefined,
): AcquiredVideo[] {
  const byId = new Map<string, AcquiredVideo>();
  for (const year of Object.values(entry?.years ?? {})) {
    for (const video of year.videos) {
      if (!byId.has(video.videoId)) byId.set(video.videoId, video);
    }
  }
  return [...byId.values()];
}

/**
 * Whether a video's publication time falls inside the window. An unparseable
 * publication time is not in any window: a video we cannot date is a video we
 * cannot show qualifies, and coverage never outranks accuracy here.
 */
export function isInWindow(
  publishedAt: string,
  window: PublicationWindow,
): boolean {
  const at = Date.parse(publishedAt);
  if (Number.isNaN(at)) return false;
  return at >= Date.parse(window.start) && at <= Date.parse(window.end);
}

export async function loadChannelCache(
  stateDir: string,
): Promise<ChannelCache> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(stateDir, CACHE_FILE), "utf8"),
    ) as ChannelCache;
    return { agencies: parsed.agencies ?? {} };
  } catch {
    return { agencies: {} };
  }
}

export async function saveChannelCache(
  stateDir: string,
  cache: ChannelCache,
): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    path.join(stateDir, CACHE_FILE),
    JSON.stringify(cache, null, 2),
  );
}
