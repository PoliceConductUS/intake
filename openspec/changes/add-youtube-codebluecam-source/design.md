# Design

Keeps the per-agency search boundary the rank-1 channel established (ADR 0023):
acquire searches **within the channel, per agency** and stamps each hit with the
agency's namespace-local source id; transform resolves officers **within that
known agency**. The agency therefore comes from the database by construction and
is never inferred from video text — there is no agency-from-free-text resolution.

That boundary is what makes "definitively linked to an officer **and** to that
officer's agency, both already in the database" true by construction rather than
by a check that could be forgotten.

## Where the rolling window lives

A rolling window depends on when a run happens, but `transform` must stay a pure
function of its inputs (ADR 0022) — otherwise re-running the same acquisition
produces different links. So the clock is read exactly once, in acquire:

1. Acquire computes `window = { startAt: now - 5y, endAt: now }`.
2. It writes that window into `channel.json` and into **every** agency envelope,
   on every run — including agencies where nothing was searched because the cache
   was already current.
3. `transform` filters on the envelope's window and throws if an envelope has
   none (a stale envelope from before this change must not be read as
   "unbounded").

Re-running only `transform` reproduces the previous links exactly; the window
advances when acquire next runs. That is the intended reading of "each run
considers only videos published within the rolling five-year period ending at
that run".

## Year buckets are a quota device, not the window

The YouTube Data API charges 100 quota units per search call, so a run does one
search per agency. The cache keeps per-agency, per-year buckets:

- The **current** year's bucket is never finished — the channel keeps publishing
  into it — so it is re-searched once its `searchedAt` is older than
  `YOUTUBE_REFRESH_DAYS` (default 7). The rank-1 source's `nextYearToAcquire`
  returns `null` for an already-searched current year, so new videos in the
  current year are never picked up; `planYearToAcquire` fixes that.
- Otherwise the newest not-yet-searched older year inside the window is
  backfilled, newest first.
- The oldest bucket's `publishedAfter` is clamped to `window.startAt`. This is
  safe because the window only moves forward: a video clamped out today can never
  re-enter the window later.
- Buckets for years before the window's floor year are pruned, so state stays
  bounded as the window rolls.

## Skips are not recorded

A video that names no officer, or whose mentions resolve to nothing or
ambiguously, produces no link and **no negative record**. The video stays in the
cache, every later run re-reads it from the envelope and re-resolves its
mentions, so the moment the officer and agency exist the link appears. This is
why the acceptance criterion "a later run picks up a previously skipped,
still-in-window video" needs no backfill job — it is the default behavior, and
the test asserts it by running the same envelope twice against two different
resolver states.

## Idempotency

Three independent layers:

- `CoverageLinks` records are keyed by the stable YouTube **video id**, and
  `CoverageLinkAgencyPersonnel` by `videoId|agencyPersonnelId`, so a re-run
  replaces rather than appends.
- `coverage_links.normalized_url` is UNIQUE, and `normalizeVideoUrl` is derived
  from the video id, so the same video canonicalizes identically every run.
- The per-agency cache means an unchanged channel costs no new search calls.

## Pinned channel id

`@CodeBlueCam` is a handle; `UCCKkuXux09y-TCg-BQxCjNA` is the channel. The id was
read from the `externalId` field of the public channel page on 2026-10-24 and
corroborated by that page's canonical `/channel/UCCKkuXux09y-TCg-BQxCjNA` links
and its `Code Blue Cam - YouTube` title. Acquire resolves the handle through
`channels?forHandle` each run and aborts on a mismatch: a renamed or transferred
handle would otherwise attach a different publisher's claims to named officers
under this source's name.
