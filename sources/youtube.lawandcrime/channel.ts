import type { DateWindow } from "../lib/youtube.js";
import {
  nextYearToAcquire,
  type AgencyVideoCacheEntry,
} from "../lib/youtube-video-cache.js";

// The channel this source ingests, named by its IMMUTABLE id. A YouTube handle
// can be renamed or transferred to a different channel; an id cannot, so the id
// is the identity and the handle/title are provenance only. Resolved from the
// official channel page on 2026-10-24: https://www.youtube.com/@LawAndCrime
// declares rel=canonical https://www.youtube.com/channel/UCz8K1occVvDTYDfFo7N5EZw
// with channel title "Law&Crime Network".
export const SOURCE_ID = "youtube.lawandcrime";
export const CHANNEL_ID = "UCz8K1occVvDTYDfFo7N5EZw";
export const CHANNEL_HANDLE = "@LawAndCrime";
export const SOURCE_NAME = "Law&Crime Network";

/** The board-set publication window: the five years ending at the run. */
export const WINDOW_YEARS = 5;

/** The rolling publication window a run considers, as ISO instants. */
export type PublicationWindow = { from: string; to: string };

export function publicationWindow(now: Date): PublicationWindow {
  const from = new Date(now.getTime());
  from.setUTCFullYear(from.getUTCFullYear() - WINDOW_YEARS);
  return { from: from.toISOString(), to: now.toISOString() };
}

// The ISO-8601 instant the YouTube Data API returns for `snippet.publishedAt`.
// Matched strictly before parsing: `Date.parse` also accepts loose, non-standard
// text ("sometime in 2023" lands on a real instant), which would place a video
// whose publication time we cannot actually read inside the window.
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Whether a video's publication time falls inside the window. A missing or
 * unreadable publication time is NOT in the window: we cannot place the video in
 * the period the board scoped, so it does not qualify.
 */
export function isInWindow(
  publishedAt: string,
  window: PublicationWindow,
): boolean {
  if (!ISO_INSTANT.test(publishedAt)) return false;
  const at = Date.parse(publishedAt);
  if (Number.isNaN(at)) return false;
  return at >= Date.parse(window.from) && at <= Date.parse(window.to);
}

/** The oldest publication year any part of the window touches. */
export function windowFloorYear(window: PublicationWindow): number {
  return new Date(window.from).getUTCFullYear();
}

/**
 * The year an agency's single search call for this run should cover: the newest
 * year not yet searched (bounded backfill, at most WINDOW_YEARS runs per agency)
 * and, once the agency is backfilled to the floor, the current year again —
 * the current year is still open, so it keeps gaining videos the earlier search
 * could not have seen.
 */
export function yearToSearch<TVideo>(
  entry: AgencyVideoCacheEntry<TVideo> | undefined,
  floorYear: number,
  currentYear: number,
): number {
  return nextYearToAcquire(entry, floorYear, currentYear) ?? currentYear;
}

/**
 * The request bounds for one year's search, clipped to the window — the floor
 * year is only partly inside it, and nothing after the run instant exists yet.
 */
export function searchWindowForYear(
  year: number,
  window: PublicationWindow,
): DateWindow {
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);
  const from = Math.max(yearStart, Date.parse(window.from));
  const to = Math.min(yearEnd, Date.parse(window.to));
  return {
    publishedAfter: new Date(from).toISOString(),
    publishedBefore: new Date(to).toISOString(),
  };
}

/** The years whose cached results have aged out of the window entirely. */
export function agedOutYears<TVideo>(
  entry: AgencyVideoCacheEntry<TVideo>,
  window: PublicationWindow,
): string[] {
  const floor = windowFloorYear(window);
  return Object.keys(entry.years).filter((year) => Number(year) < floor);
}
