# Design

Mirrors the clearinghouse-api / courtlistener pattern: acquire searches **per
agency** and stamps each result with the agency's source id; run resolves
officers **within that known agency**. There is no agency-from-free-text
resolution and no agency guessing — the agency is the search key (ADR 0023).

## Acquire (network, non-deterministic — YouTube Data API v3)

1. Resolve the channel once from its handle `@PoliceActivity` to its immutable
   channel id (`channels?forHandle`) and store it.
2. Page agencies via `data.agencies({ states, minOfficers, cursor, limit })` — the
   same read-only facade CH/CL use to decide what to search (bounded by
   `minOfficers` so the YouTube search quota is spent on agencies that can
   actually match an officer).
3. For each agency, search **within the channel** (`search?channelId=…&q=…&
type=video`) using the agency name and its place/state as the query, and for
   each hit store `videoId`, `title`, `description`, `publishedAt`, channel,
   canonical `url`, retrieval time, and available caption text — **stamped with
   the agency's namespace-local source id** (like CL's `{ agency: { id, name,
state }, videos: [...] }`).
4. **Source-state, not silent success**: a deleted / private / unavailable /
   changed video is written as an explicit source-state record, never dropped.
   Re-running is idempotent (evidence keyed by agency source id + videoId).

`run` never touches the network; all non-determinism is here.

## Run (deterministic — resolve officers at the known agency, emit cited links)

Per acquired `{ agency, videos }` group, the agency source id is already known,
so for each video over `title + description + captions`:

1. **Officer** — extract candidate officer names and resolve via
   `data.resolvePersonnel({ agencyId, personnelName })` (the agency is fixed by
   acquire). Each match emits a `CoverageLinkAgencyPersonnel`.
2. A video with **≥1** verified officer link emits one `CoverageLink` (url, title,
   `published_at`, `source_name` = channel, description as attributed framing). A
   video with no verified officer link emits no durable coverage record — a
   visible unmatched result, not silent success. (The agency search alone is only
   a candidate filter; the officer resolution is the verification.)

**Case links are deferred.** `CoverageLinkCivilCase` needs a match-only
`resolveCivilCase` run capability (a coverage link may only reference an existing
civil case; emitting an unverified case ref would fail-loud at import). That
capability is a follow-up, tracked in tasks; the first cut is officer links.

### Evidence, never guessing (#52)

Every emitted link carries the supporting passage (with caption timestamp when the
match came from captions) in the link's `notes`. An officer name must appear as a
contiguous full-name mention and resolve to one existing officer at the acquired
agency; appearance, geography, title fragments, and comments are never evidence.
Ambiguous (multiple candidates) → unmatched, not a guess. `resolvePersonnel`
already applies the confidence floor and ambiguity band.

## Identity / idempotency

- CoverageLink key: normalized `url` (the video URL) — stable across runs; the
  same video found under two agencies is one CoverageLink with links to each.
- CoverageLinkAgencyPersonnel / CoverageLinkCivilCase keys: composed
  `coverageLinkKey|targetKey`, so re-runs never duplicate.

## Out of scope (first cut)

Only PoliceActivity (#64); the other channels (#65–#70) are separate sources.
Sentiment/grade extraction and comment mining are not used for linking. No new
`resolveAgency` capability is needed — the CH/CL per-agency-search pattern makes
the agency known before run.
