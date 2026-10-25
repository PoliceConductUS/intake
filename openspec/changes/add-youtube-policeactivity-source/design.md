# Design

Mirrors the clearinghouse-api / courtlistener pattern: acquire searches **per
agency** and stamps each result with the agency's source id; the produce phase
resolves officers **within that known agency**. There is no agency-from-free-text
resolution and no agency guessing — the agency is the search key (ADR 0023).

## Source configuration

`sources/youtube.policeactivity/channel.ts` is the whole configuration of the
channel: its official handle and URL, the `source_name` written on coverage links,
and the rolling-window length (5 years). Nothing about the window or the channel
is settable from the environment — a run of this source means that channel and
that window.

## Acquire (network, non-deterministic — YouTube Data API v3)

1. Resolve the declared handle `@PoliceActivity` to its stable channel id
   (`channels?part=id&forHandle=`), persist it in the source's state dir, and
   assert every later run resolves the same id — a disagreement halts the run
   rather than ingesting under a second identity.
2. Compute the rolling window once per run: `[runAt - 5 years, runAt]`.
3. Page agencies via `data.agencies({ minOfficers, cursor, limit })` — the same
   read-only facade CH/CL use to decide what to search (bounded by `minOfficers`
   so the search quota is spent on agencies that can match an officer at all).
4. For each agency, fetch **one** search slice per run (the quota is ~100 search
   calls/day, against ~18k agencies, so slices are deliberately small):
   - the newest calendar year the window covers that this agency has never been
     searched for (backfill, newest first), clipped to the window bounds;
   - once every covered year has been searched, the year the window **ends** in,
     re-searched — it is the only slice that can still gain videos.
5. Each hit is cached under the agency + year with its `videoId`, `title`,
   `description`, `publishedAt`, `channelId`, canonical `url`, and `retrievedAt`.
   A re-observation replaces the cached one (newest observation wins), so a
   changed title reaches the coverage link as an update. The cache is the raw
   evidence and is never pruned.
6. Per agency, write `<agency-slug>.videos.json`: the channel identity, the run's
   window, the agency's source id/name/state/place/county, and the agency's cached
   videos **filtered to the window** — the deterministic input the produce phase
   reads.

Only the Data API is used. `youtube.com/robots.txt` disallows `/api/`, so the
`/api/timedtext` caption track is not fetched: candidate officer names come from
the title and description. No media is requested or stored.

## Produce (deterministic — resolve officers at the known agency, emit cited links)

Per `<agency-slug>.videos.json` envelope (validated fail-loud; a missing window
stamp, publication time, or retrieval time is an error, not a skip):

1. Keep only videos inside the window **stamped on the envelope** — the produce
   phase never reads the clock, so it stays deterministic for its input.
2. **Officer** — extract candidate officer names from title + description and
   resolve via `data.resolvePersonnel({ agencyId, personnelName })` (the agency is
   fixed by acquire). Each match emits a `CoverageLinkAgencyPersonnel` citing the
   naming passage.
3. A video with **≥1** verified officer link emits one `CoverageLink` (url, title,
   `published_at`, `source_name` = channel, description as attributed framing). A
   video with no verified officer link emits no durable coverage record — a
   visible unmatched result, not silent success. (The agency search alone is only
   a candidate filter; the officer resolution is the verification.)

### Deferred matches retry themselves

An unmatched video stays in the cache and in every later in-window envelope, and
the produce phase re-resolves it against the **current** database on every run.
So a video skipped for a missing officer becomes a link on the first run after
that officer and agency exist, with no re-acquisition and no durable "rejected"
verdict to clear. It stops being considered when it ages out of the window.

### Evidence, never guessing (#52)

Every emitted link carries the supporting passage in the link's `notes`. An
officer name must appear as a contiguous full-name mention and resolve to one
existing officer at the acquired agency; appearance, geography, title fragments,
and comments are never evidence. Ambiguous (multiple candidates) → unmatched, not
a guess. `resolvePersonnel` already applies the confidence floor and ambiguity
band.

## Identity / idempotency

- CoverageLink key: the stable YouTube `videoId` — stable across runs; the same
  video found under two agencies is one CoverageLink with links to each.
- CoverageLinkAgencyPersonnel key: `videoId|agencyPersonnelId`, so re-runs never
  duplicate.
- Channel id, retrieval time, and full publication timestamp are preserved in the
  acquisition evidence (cache + envelope); `coverage_links` has no column for
  them, and the namespace + `videoId` key ties each row back to that evidence
  through the source-name ledger.

## Out of scope

- Only PoliceActivity (#64); the other channels (#65–#70) are separate sources
  with their own configuration under `sources/<namespace>`.
- Explicit source-state records for deleted/private videos (the Data API search
  simply omits them; detecting a disappearance against the cache is unbuilt).
- Case links: a `CoverageLinkCivilCase` path needs a match-only `resolveCivilCase`
  capability and is not part of this source.
- Sentiment/grade extraction and comment mining are not used for linking.
