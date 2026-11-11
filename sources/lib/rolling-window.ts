// The rolling publication window a video-coverage source considers on one run:
// the `years`-long period ending at that run's clock reading. Every run
// recomputes it, so a video inside it is reconsidered on every run until it ages
// out — and a video outside it is never searched for, stored, or linked.

export type PublicationWindow = { start: string; end: string };

export function rollingWindow(runAt: Date, years: number): PublicationWindow {
  if (!Number.isInteger(years) || years <= 0) {
    throw new Error(
      `rollingWindow: years must be a positive integer, got ${String(years)}`,
    );
  }
  const start = new Date(runAt);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  return { start: start.toISOString(), end: runAt.toISOString() };
}

function instant(label: string, iso: string): number {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) {
    throw new Error(`rolling window: ${label} is not a timestamp: ${iso}`);
  }
  return at;
}

export function isWithinWindow(
  publishedAt: string,
  window: PublicationWindow,
): boolean {
  const at = instant("publishedAt", publishedAt);
  return (
    at >= instant("window.start", window.start) &&
    at <= instant("window.end", window.end)
  );
}
