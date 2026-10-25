## Why

The board's subscriber-ordered intake-source queue asks for one independent
config-driven YouTube source per channel. Law&Crime Network is rank 4 of 6
(INS-50). `sources/youtube.policeactivity` established the shape — per-agency
channel search, officer resolution against the existing roster, cited coverage
links — and this change adds the second channel on that shape, plus the two
behaviors the board specified for it that no existing source has: a **rolling
five-year publication window** and **automatic reconsideration of every video
that was skipped for want of a matching officer or agency**.

The hard rules are unchanged: a video is an _attributed claim_, never a canonical
fact. A video becomes a durable coverage link only when it resolves to an
**existing** officer at an **existing** agency, with the naming passage cited. No
agency and no personnel record is ever minted from a video, and no video media is
ingested or stored — only links.

## What Changes

**New source `sources/youtube.lawandcrime/` (acquire + transform)**

- From: Law&Crime Network coverage is not ingested at all.
- To: `acquire.ts` verifies the pinned channel id, pages agencies via the
  `data.agencies(...)` facade, and searches **within that channel** per agency
  per year across the rolling five-year window, caching one agency-year per
  search; `transform.ts` reads the acquired envelopes and emits
  `CoverageLinks` + `CoverageLinkAgencyPersonnel` only for videos naming an
  officer that resolves to exactly one existing officer at that agency.
- Reason: ingest rank-4 accountability coverage as cited links on records we
  already hold.
- Impact: additive namespace `youtube.lawandcrime`. No schema change, no
  migration, no new artifact kind — it emits the existing CoverageLink kinds.

**Channel identity is the channel id, not the handle**

- The source pins the immutable channel id `UCz8K1occVvDTYDfFo7N5EZw`
  (`@LawAndCrime`, "Law&Crime Network") and selects the channel **by id** through
  `channels.list?id=`. A YouTube handle is mutable and transferable; an id is
  not. The handle and display title are recorded as provenance and the run fails
  loudly when the pinned id does not resolve to a live channel. Both phases check
  it: acquire verifies the channel, and transform re-verifies the archived
  `channel.json` and every video's `channelId`, so the guarantee survives a
  replay in which acquire never runs.

**Rolling five-year window, evaluated in acquire**

- Each run considers only videos published in the five-year period ending at that
  run. The window is a function of the run clock, and `transform` must be
  deterministic with no dependence on wall-clock time
  (`config-driven-source-import`), so the window is computed in **acquire**,
  recorded in the envelope, and used there to bound both the search request and
  the videos written to the envelope. `transform` then stays a pure function of
  the envelope and needs no clock.
- When an agency-year ages out of the window its cache entry and its videos are
  dropped from the envelope, so they stop producing new links. Already-imported
  rows are untouched: a record absent from a later manifest produces no delete
  mutation (`config-driven-source-import`). The window governs which links are
  **created**, not retroactive removal.

**Previously skipped videos are reconsidered, not forgotten**

- Every run re-writes each agency's envelope from the full in-window cache and
  `transform` re-resolves every video in it. A video that matched nothing on run
  N — because the officer, or the agency itself, was not in the database yet —
  is re-evaluated on run N+1 and links automatically once both exist, with no
  re-fetch and no manual backfill. Skipping is a per-run outcome, never a durable
  exclusion.

**No captions for this source**

- `sources/lib/youtube.ts` can read a video's caption track from
  `https://www.youtube.com/api/timedtext`. `https://www.youtube.com/robots.txt`
  carries `Disallow: /api/`, so this source does not fetch captions: officer-name
  candidates come from the video title and description returned by the Data API
  (`www.googleapis.com`, keyed, under the API terms) only. This costs recall —
  an officer named only in the spoken audio will not match — and accuracy and
  access-terms compliance outrank coverage. The pre-existing caption fetch in
  `youtube.policeactivity` is reported to the board separately; this change does
  not extend it.

**Shared, channel-agnostic extraction (behavior-preserving refactor)**

- The pieces that are identical for any channel move to `sources/lib/`:
  the keyed retrying Data API fetchers with their raw-response log
  (`createKeyedYoutubeFetchers`), the per-agency-year search cache
  (`youtube-video-cache.ts`, now generic over the cached video payload), and the
  officer-mention extraction and URL normalization (`youtube-coverage.ts`).
  `youtube.policeactivity` is rewired onto them with no change to its observable
  behavior — same requests, same retry policy, same log lines, same emitted
  records — so there is one implementation of each, not two. Its existing tests
  are the guard.

**Provenance**

- The acquire envelope is the durable provenance record for each video: stable
  video id, canonical URL, channel id, publication time, retrieval time, the
  declared window, and the agency source id the video was found for — alongside
  the unchanged raw API responses in `.api-calls.jsonl`.
- `CoverageLinkSpec` is strict and has only `url`, `normalized_url`, `title`,
  `source_name`, `published_at`, and `notes`. Channel id and retrieval time
  therefore live in the evidence envelope, not on the database row. Adding
  columns for them would be a schema change this change does not need; if the
  board wants channel and retrieval time queryable on `coverage_links`, that is a
  separate proposal.

**Env**

- `YOUTUBE_API_KEY` (acquire only) — already documented in `.env.example`.
