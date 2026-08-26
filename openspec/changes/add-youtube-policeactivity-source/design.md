# Design

## Acquire (network, non-deterministic — YouTube Data API v3)

1. Resolve the channel **once** to its immutable channel id from the handle
   `@PoliceActivity` (`channels?forHandle`), and store it. Video ids and the
   channel id are the stable identities (#52).
2. Page the channel's uploads playlist (`playlistItems`, 50/page) — for each
   video store `videoId`, `title`, `description`, `publishedAt`, `channelId`,
   canonical `url`, and retrieval time as raw evidence under `sourceDir`.
3. For each video, fetch available caption text (timedtext) and store it verbatim
   as evidence; record when none is available (caption provenance is part of
   video identity per #52).
4. **Source-state, not silent success**: a deleted / private / unavailable /
   changed video is written as an explicit source-state record (mirrors the
   `excluded.yaml` fail-loud pattern), never dropped quietly. Re-running the same
   channel state adds no new evidence for unchanged videos (keyed by videoId).

`run` never touches the network; all non-determinism is here.

## Run (deterministic — resolve to existing records, emit cited links)

Per acquired video, over `title + description + captions`:

1. **Agency** — extract candidate agency mentions and resolve via
   `data.resolveAgency({ name, state })` (match-only). No agency → the video
   yields no officer/agency links (a visible unmatched result), though a case
   docket may still match.
2. **Officer** — within a resolved agency, extract candidate officer names and
   resolve via `data.resolvePersonnel({ agencyId, personnelName })`. A match
   emits a `CoverageLinkAgencyPersonnel`.
3. **Case** — extract docket tokens and resolve to an existing CivilCase by its
   natural key (`court:docket`, ADR 0028); a match emits a
   `CoverageLinkCivilCase`.
4. A video with **≥1** verified link emits one `CoverageLink` (url, title,
   `published_at`, `source_name` = channel, description as attributed framing).
   A video with **no** verified link emits no durable coverage record.

### Evidence, never guessing (#52)

Every emitted link carries the supporting passage (and caption timestamp when the
match came from captions) in the link's `notes`. Matching is exact/high-confidence
only: an officer name must appear as a contiguous full-name mention and resolve to
one existing officer at the resolved agency. Appearance, geography, title
fragments, and comments are never evidence. Ambiguous (multiple candidates) →
unmatched, not a guess.

## resolveAgency capability

`RunDataContext.resolveAgency({ name, state? }): Promise<{ agencyId: string } | null>`
— intake-owned, match-only, returns a namespace-local agency source id or null
(never a canonical id, never a mint), symmetric with `resolvePersonnel`. Backed
by the same fuzzy agency matcher the acquire `agencies()` facade already uses,
gated to return null below a confidence threshold.

## Identity / idempotency

- CoverageLink key: normalized `url` (the video URL) — stable across runs.
- CoverageLinkAgencyPersonnel / CoverageLinkCivilCase keys: composed
  `coverageLinkKey|targetKey`, so the same video↔officer/case link converges on
  one row and re-runs never duplicate.

## Out of scope (first cut)

Only PoliceActivity (#64). The other channels (#65–#68) are separate sources.
Sentiment/grade extraction and comment mining are not used for linking.
