## Why

Code Blue Cam is channel #3 of the six board-ranked accountability channels
(issue #52 family; INS-49). It lands after the config-driven source intake
redesign (#59), so it is the first of the family to be built as a thin
configuration over a shared channel implementation rather than a copy of
`sources/youtube.policeactivity/`.

The hard rule is unchanged: the channel's framing is an _attributed claim_, never
a canonical fact, and the importer **never guesses** an officer or agency. A video
becomes a durable coverage link only when it resolves to an **existing** officer
at an **existing** agency, with the supporting passage cited. No agency and no
personnel record is ever minted from a video, and no video media is stored — only
links.

Two requirements in INS-49 are not satisfied by the rank-1 source's behavior and
drive most of this change:

1. **A rolling five-year window**, not a calendar-year floor. `youtube.policeactivity`
   bounds its backfill with `YOUTUBE_MIN_YEAR` and its run phase applies no window
   at all, so a cached video stays linkable forever. This source computes the
   window from the acquire run's clock, records it in every envelope, and the
   transform refuses to emit a link for a video outside it.
2. **Skips must be reconsidered, not remembered.** A video whose officer is not in
   the database yet is skipped without recording the skip, and every later run
   re-evaluates every cached in-window video — so the link appears automatically
   once the officer and agency exist, with no backfill job.

## What Changes

**New shared implementation `sources/lib/youtube-channel.ts` + `sources/lib/youtube-video-cache.ts`**

- From: channel behavior lives inside `sources/youtube.policeactivity/`, so each
  of the six channels would copy ~400 lines and drift independently.
- To: a `ChannelSourceConfig` (`namespace`, `sourceName`, `channelHandle`,
  pinned `channelId`, `channelIdProvenance`) plus `createChannelAcquire` /
  `createChannelTransform`. The window math, the pinned-channel check, URL
  canonicalization, the officer-mention extractor and the resolve gate are
  defined once.
- Impact: additive. `sources/youtube.policeactivity/` is **not** modified by this
  change — it keeps its own copy until it adopts the shared factory (see
  `tasks.md` 4.1); migrating it would change a landed source's behavior, which
  belongs to its own issue.

**New source `sources/youtube.codebluecam/` (config only)**

- `channel.ts` pins the channel: `@CodeBlueCam` → `UCCKkuXux09y-TCg-BQxCjNA`.
- `acquire.ts` / `transform.ts` are each a two-line binding of the shared factory.
- Discovery is by convention (`sources/<namespace>/transform.ts`, see
  `src/cli/source-glob.ts`), so no registry edit is needed.

**The channel id is pinned, and a mismatch fails the run**

- A YouTube handle is mutable — it can be renamed or transferred to a different
  channel. Acquire resolves the handle every run and **refuses to ingest** when it
  no longer resolves to the pinned id, rather than silently ingesting another
  publisher's videos under this source's name and attaching them to named
  officers.

**Case-preserving URL canonicalization**

- `coverage_links.normalized_url` carries a UNIQUE index. YouTube video ids are
  case-sensitive base64url, so lowercasing a whole watch URL can map two distinct
  videos onto one key — under that index one video would block the other, or
  officer links would land on the wrong video. `normalizeVideoUrl` lowercases only
  the scheme and host.

## Impact

- Migrations / seed rows: **none**. The source uses the existing `CoverageLinks`
  and `CoverageLinkAgencyPersonnel` kinds; no data reset, no generated type
  refresh, no production migration plan.
- Known schema gap (not addressed here): `CoverageLinkSpec` is `.strict()` and
  `coverage_links.published_at` is a `date`, so the channel id, the full
  publication timestamp and the retrieval time have no first-class columns. They
  are preserved structurally in the acquire envelope and carried onto the
  published row as a delimited provenance line in `notes`. First-class provenance
  columns would serve all six channels at once and should be one separate change.

**Env**

- `YOUTUBE_API_KEY` (acquire only) — already documented in `.env.example`.
- `YOUTUBE_REFRESH_DAYS` (optional, default 7) — how long the current year's
  channel search stays fresh before the next run redoes it.
