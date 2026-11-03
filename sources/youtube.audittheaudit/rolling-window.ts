// The rolling five-year period ending at the run (INS-51). The window is
// computed once, in acquire, and recorded in the evidence it writes: acquire owns
// wall-clock time, so the transform stays deterministic for its inputs and still
// applies the exact period the evidence was gathered for.

export const WINDOW_YEARS = 5;

export type RollingWindow = { startsAt: string; endsAt: string };

// An ISO 8601 instant. `Date.parse` alone is far too permissive — it reads
// "sometime in 2024" as 2024-01-01 — and a video whose publication time we cannot
// read exactly must not qualify for the window.
const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function instant(value: string): number {
  return INSTANT.test(value) ? Date.parse(value) : Number.NaN;
}

/**
 * The five-year period ending at `now`. The start is the same calendar instant
 * five years earlier; a 29 February start normalizes to 1 March, the same way
 * `Date` normalizes every other impossible date.
 */
export function rollingWindow(now: Date): RollingWindow {
  const startsAt = new Date(now.getTime());
  startsAt.setUTCFullYear(startsAt.getUTCFullYear() - WINDOW_YEARS);
  return { startsAt: startsAt.toISOString(), endsAt: now.toISOString() };
}

function year(value: string): number {
  const parsed = instant(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Not an instant: ${value}`);
  }
  return new Date(parsed).getUTCFullYear();
}

/** The calendar years the window touches, newest first. */
export function windowYears(window: RollingWindow): number[] {
  const first = year(window.startsAt);
  const last = year(window.endsAt);
  const years: number[] = [];
  for (let current = last; current >= first; current -= 1) {
    years.push(current);
  }
  return years;
}

/**
 * The date bounds for searching one calendar year, clamped to the window — so
 * the oldest and newest years of the window are searched only over the part of
 * them that is inside it.
 */
export function yearSearchWindow(
  searchYear: number,
  window: RollingWindow,
): { publishedAfter: string; publishedBefore: string } {
  const yearStart = `${searchYear}-01-01T00:00:00.000Z`;
  const yearEnd = `${searchYear + 1}-01-01T00:00:00.000Z`;
  return {
    publishedAfter:
      Date.parse(yearStart) > Date.parse(window.startsAt)
        ? yearStart
        : window.startsAt,
    publishedBefore:
      Date.parse(yearEnd) < Date.parse(window.endsAt) ? yearEnd : window.endsAt,
  };
}

/** True when `publishedAt` is an instant inside the window, bounds included. */
export function isInWindow(
  publishedAt: string,
  window: RollingWindow,
): boolean {
  const at = instant(publishedAt);
  return (
    Number.isFinite(at) &&
    at >= instant(window.startsAt) &&
    at <= instant(window.endsAt)
  );
}
