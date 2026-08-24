## Why

Every source in `sources/` today is a records source: a POST roster, a court
docket API, a census file. The board has asked for a subscriber-ranked queue of
YouTube channels that cover policing incidents, starting with Donut Operator
(~5.31M subscribers on 2026-08-24, rank 1).

That is a different kind of source, and the difference is the whole point of
writing this down. A POST roster is a record _of_ an officer's employment. A
YouTube video is one person's commentary _about_ an incident. Both are useful;
only the first can support a claim about a named human being. If a media source
lands in `sources/` without that distinction stated in a durable spec, the next
person to touch it has no reason not to parse officer names out of video titles
and write `CoverageLinkAgencyOfficer` rows — which is precisely how a police
accountability database attaches the wrong person to the wrong incident.

So this change adds the source and, in the same breath, specifies the ceiling on
what a media-channel source is allowed to emit.

## What Changes

**A per-channel media source namespace**

- From: no media/commentary source exists; `sources/` holds records sources only.
- To: `sources/com.youtube.donutoperator/` with the standard `acquire` (network)
  and `run` (deterministic) phases, emitting `CoverageLinks` — one per public
  upload, keyed by the YouTube video ID.
- Reason: the intake-source queue is ordered by channel, so the namespace is the
  channel. Reverse-DNS (`com.youtube.<channel>`) matches `gov.tx.tcole` and
  keeps rank 2..n additive rather than a shared `youtube` grab bag.
- Impact: additive. `CoverageLinks` has `dependsOn: []` and is already wired
  through the pipeline (mn-post emits it), so no registry, schema, migration, or
  envelope change is required.

**Identity is the channel ID, never the handle or the display name**

- From: n/a.
- To: `channel.ts` pins `UCwkm_Wcyh0pc7UUmZZfL-6w`. `acquire` resolves the
  channel by ID through `channels.list` and fails if the API returns anything
  else. `run` re-checks the acquired `channel.json` and rejects any playlist item
  whose `snippet.channelId` is not the pinned ID.
- Reason: a handle (`@DonutOperator`) and a title are labels the channel owner
  can change or release to someone else; the channel ID cannot change. Drift in
  either label is logged as evidence, not treated as a failure — a rename must
  not silently repoint ingestion at a different channel, and must not break it
  either.
- Impact: the source has no name-matching code path to regress into.

**A media source emits coverage, not associations**

- From: n/a — no rule stated.
- To: the source declares `produces: ["CoverageLinks"]` and nothing else. The
  run command already rejects any undeclared emitted kind, so
  `CoverageLinkAgencyOfficers` from this namespace is a hard failure, not a
  review comment.
- Reason: this source has no stable officer identifier. Linking a video to a
  named officer would require matching a person out of a title or description —
  display-name matching against named human beings, with no way to be right
  reliably.
- Impact: coverage from this channel is catalogued and attributable to the
  video, and attaches to no personnel record until a reviewed mechanism exists.

**Sanctioned access only**

- From: n/a.
- To: `acquire` reads the YouTube Data API v3 (`channels.list`,
  `playlistItems.list`) with `YOUTUBE_API_KEY`, preserves every raw response
  unchanged, and retries only 429/5xx. A 403 (quota exhausted or bad key) fails
  immediately.
- Reason: YouTube's terms prohibit scraping the site; the Data API is the
  channel it offers, and it is free within the default quota. Retrying a 403 is
  working around a limit rather than respecting it.
- Impact: the source cannot run without an API key, and fails loudly saying so.

## Capabilities

### New Capabilities

- `youtube-coverage-source`: a per-channel YouTube media source that resolves by
  channel ID, acquires through the YouTube Data API v3 into a preserved raw
  snapshot, and deterministically emits one `CoverageLink` per public upload
  keyed by video ID — while being structurally barred from emitting personnel
  associations.

### Modified Capabilities

<!-- None. `config-driven-source-import` and the run-order contract are used as
specified; no existing requirement changes. -->

## Impact

- **New code**: `sources/com.youtube.donutoperator/{channel,acquire,run}.ts`;
  `test/sources/com.youtube.donutoperator/run.test.ts`.
- **Modified code**: none. `CoverageLinks` is an existing registered kind with
  `dependsOn: []`, already read, transformed, and persisted by the pipeline.
- **Env**: new `YOUTUBE_API_KEY`, required for `intake acquire`, unused by
  `intake run`.
- **No** migration, seed change, generated-type change, or dependency addition.
- **Cost**: none. The YouTube Data API's free quota (10,000 units/day) covers a
  full channel re-pull; `playlistItems.list` costs 1 unit per 50-item page.
- **Out of scope**: linking coverage to officers or civil cases; ranks 2..n of
  the channel queue; any public rendering of this data; retention/refresh policy
  for re-acquiring a channel.
