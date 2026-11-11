// Donut Operator's pinned channel identity and this source's eligibility window.
//
// Identity is pinned to the immutable channel id, not the handle. A handle can be
// renamed or released and re-registered by someone else; the id cannot change. The
// handle is still resolved at acquire time and asserted to equal the pinned id, so
// a handle that has moved to a different channel fails the run loudly instead of
// quietly repointing ingestion at a stranger's uploads.
export const CHANNEL_HANDLE = "@DonutOperator";
export const CHANNEL_ID = "UCwkm_Wcyh0pc7UUmZZfL-6w";
export const SOURCE_NAME = "Donut Operator";
export const SOURCE_ID = "youtube.donutoperator";

/**
 * The rolling eligibility window, in years. Fixed by the board for this source,
 * so it is a constant rather than an env knob — `YOUTUBE_MIN_YEAR` (which widens
 * the sibling channel sources' backfill) is deliberately ignored here.
 */
export const WINDOW_YEARS = 5;

/**
 * The start of the window for a run at `now`: `now` minus `WINDOW_YEARS`.
 *
 * Calendar arithmetic, not 5×365 days, so the window edge stays on the same
 * month/day. A Feb 29 run lands on Mar 1 five years earlier (that Feb 29 does not
 * exist), which is deterministic and a one-day effect at the oldest edge.
 */
export function windowStart(now: Date): Date {
  const start = new Date(now.getTime());
  start.setUTCFullYear(start.getUTCFullYear() - WINDOW_YEARS);
  return start;
}

/** The oldest calendar year the window touches (it may touch it only partly). */
export function windowFloorYear(now: Date): number {
  return windowStart(now).getUTCFullYear();
}

// An RFC 3339 instant (what the YouTube Data API returns) or a plain calendar
// date. The shape is checked BEFORE parsing because `new Date(…)` is lenient:
// it reads "sometime in 2024" as a real instant inside the window. A date we
// only think we understand must not be able to make a video eligible.
const PUBLISHED_AT =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/;

/**
 * Whether a video's publication instant falls inside the window ending at `now`.
 *
 * Inclusive at the start edge. A publication time that is missing, malformed, or
 * not an unambiguous instant is NOT in the window: eligibility has to be shown,
 * not assumed, and a video we cannot date cannot be shown to be recent. A time in
 * the future (a scheduled premiere) is likewise outside a period ending at `now`.
 */
export function inWindow(
  publishedAt: string | null | undefined,
  now: Date,
): boolean {
  if (typeof publishedAt !== "string") return false;
  const raw = publishedAt.trim();
  if (!PUBLISHED_AT.test(raw)) return false;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return false;
  return (
    at.getTime() >= windowStart(now).getTime() && at.getTime() <= now.getTime()
  );
}

/**
 * The instant a phase treats as "now".
 *
 * Defaults to the wall clock. `YOUTUBE_WINDOW_NOW` pins it to an explicit ISO
 * instant, which is what makes the window testable and a past run's emission
 * re-derivable; an unparseable value fails loudly rather than silently falling
 * back to the wall clock and changing which videos are eligible.
 */
export function runClock(env?: Record<string, string | undefined>): Date {
  const pinned = env?.YOUTUBE_WINDOW_NOW?.trim();
  if (pinned === undefined || pinned === "") return new Date();
  const at = new Date(pinned);
  if (Number.isNaN(at.getTime())) {
    throw new Error(
      `${SOURCE_ID}: YOUTUBE_WINDOW_NOW is not a parseable instant: ${pinned}`,
    );
  }
  return at;
}
