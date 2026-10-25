## Why

The board queued six YouTube channels as intake sources, one issue per channel,
ordered by subscriber count. LegalEagle is rank 6 (INS-52). PoliceActivity
(rank 1) already landed as `sources/youtube.policeactivity/` in the
config-driven source redesign (intake PR #59, INS-47), and four more channels
are queued behind it (INS-46, INS-49, INS-50, INS-51).

Those six sources differ only in **which channel they read**. Copying the
existing acquire + transform pair once per channel would duplicate ~375 lines
six times, which the Prime Directive forbids. So this change does two things:
it extracts the channel-coverage behavior into one shared implementation, and
it adds LegalEagle as the first source that is purely _configuration_ naming a
channel.

INS-52 also specifies behavior the existing source does not have: a **rolling
five-year publication window ending at the run**, rather than
`YOUTUBE_MIN_YEAR`'s calendar-year floor. That window must be enforced where
links are emitted, not only where videos are searched, because the acquired
cache outlives the window it was fetched under.

The hard rule is unchanged: the channel's framing is an _attributed claim_,
never a canonical fact. A video becomes a durable coverage link only when it
resolves to an **existing** officer at an **existing** agency, with the
supporting passage cited. No agency or personnel record is ever minted from a
video, and no video media is ingested or stored — only links.

## What Changes

**New shared implementation `sources/lib/youtube-channel.ts`**

- From: `sources/youtube.policeactivity/` holds the only channel
  implementation, with its handle, display name, and window floor inlined.
- To: `createChannelAcquire(config)` and `createChannelTransform(config)` hold
  the behavior once; a `ChannelSourceConfig` names the channel handle, the
  `source_name` to stamp, and the rolling window length.
- Reason: five more channels are queued; the channel identity is the only
  axis that varies.
- Impact: additive. `sources/youtube.policeactivity/` is **not** modified by
  this change — migrating it onto the shared implementation (and fixing its
  window-at-emit gap) belongs to INS-48.

**New source `sources/youtube.legaleagle/` (acquire + transform)**

- From: no way to ingest LegalEagle coverage.
- To: two configuration modules that call the shared factories with
  `handle: "@LegalEagle"`, `sourceName: "LegalEagle"`, `windowYears: 5`.
- Impact: additive namespace `youtube.legaleagle`. No schema, migration,
  registry, or envelope change — sources are discovered by the presence of
  `transform.ts`, and `CoverageLinks` / `CoverageLinkAgencyPersonnel` are
  existing kinds already wired through the pipeline.

**Rolling window enforced at both phases**

- Acquire computes the window once per run from the run instant, clips every
  search to it, and **stamps it into each written envelope** alongside the
  retrieval time.
- Transform reads the window from the envelope rather than from the clock, so
  it stays deterministic and so a replay reproduces the run it replays.
- A cached video whose `publishedAt` has since fallen out of the window emits
  no link.

**Channel identity**

- The config names the channel by **handle**; acquire resolves it to the
  immutable channel id through `channels.list?forHandle=`, writes
  `channel.json`, and fails loudly when it does not resolve. The channel id is
  not checked in, because it cannot be verified from this repo without a
  provisioned `YOUTUBE_API_KEY` (INS-53), and an unverified pinned id is
  exactly the kind of unsourced claim this project refuses to publish.
- Every acquired video carries the `channelId` the API returned for it.

**Fair acquisition order**

- Acquire searches one agency-year per agency per run to pace the YouTube
  search quota. Agencies are ordered **stalest-first** so a run that halts on
  exhausted quota resumes with the agencies it did not reach, instead of
  re-searching the same head of the cursor every run and starving the tail.

**Env**

- `YOUTUBE_API_KEY` (acquire only) — already documented in `.env.example`.
- `YOUTUBE_MIN_YEAR` is **not** read by this source; its window is the rolling
  five years the issue specifies.

## Out of scope

- Publishing anything to the public site. These are internal coverage links on
  personnel records, which remain behind the personnel publication gate.
- Storing channel id / retrieval time as `coverage_links` columns.
  `CoverageLinkSpec` is `.strict()` with a fixed field set; that provenance is
  preserved in the acquired evidence (`*.videos.json`, `channel.json`,
  `.api-calls.jsonl`), which is the repo's evidence-preservation convention.
  Widening the published schema is a separate, cross-source change.
