# Design

## The axis that varies

Six channels, one behavior. `ChannelSourceConfig` is the whole difference:

```ts
type ChannelSourceConfig = {
  namespace: string; // for log lines and error messages only
  handle: string; // "@LegalEagle" — resolved to the immutable id at acquire
  sourceName: string; // CoverageLink.source_name
  windowYears: number; // rolling publication window, ending at the run instant
};
```

`namespace` is used only to prefix messages. Nothing in the shared
implementation branches on it, which is what keeps this out of the
"no source-ID-specific special cases" prohibition.

## Why the window is stamped into the envelope

The acquired cache outlives the window it was fetched under. A video legitimately
searched five years ago sits in `video-cache.json` forever; a rolling window
means it eventually stops qualifying. Two consequences:

1. The window must be enforced at **emit** time, not only at search time.
2. Transform must not compute it from the clock. `transform` is required to be
   deterministic and replayable, and a replay of a run from three months ago
   should reproduce that run's links, not today's. So acquire writes
   `window: { start, end }` and `retrievedAt` into each `*.videos.json`
   envelope, and transform reads it from there.

This also satisfies INS-52's requirement to preserve the retrieval time: it is
on the envelope and on each video.

## Why the channel id is not checked in

The sibling rank-2 attempt (branch `ins46/youtube-donutoperator`) pinned the
channel id in code. That is the stronger guarantee _if the id is verified_ —
but `YOUTUBE_API_KEY` is not provisioned (INS-53 is blocked), so nothing in this
repo can verify an id today. A pinned-but-unverified id is an unsourced claim
about which channel our links came from, and it would be silently wrong forever.

Resolving by handle through `channels.list?forHandle=` makes the resolution a
visible, logged, fail-loud step at run time and writes the result to
`channel.json` as evidence. When INS-53 lands and an id is verified against the
live API, pinning it becomes a one-line config change.

**Known ambiguity, not resolved here:** the board gave the channel URL as
`https://www.youtube.com/c/LegalEagle`, which is a legacy `/c/` custom URL, not
a handle. This design resolves `forHandle=LegalEagle`. Those are the same
channel for every channel we have checked by hand, but they are different
namespaces in YouTube's API and only a keyed `channels.list` call proves it for
this channel. The first real acquire run is what confirms it; until then the
mapping is an assumption, recorded here and in the board comment.

## Acquisition pacing and fairness

One YouTube search costs 100 quota units against a 10,000/day default. Searching
~18,000 agencies across five years is far beyond that, so the existing design
searches one agency-year per agency per run and backfills over many runs. That
part is kept.

What is added is ordering. Paging agencies by cursor and halting on quota means
the same head of the cursor is searched every run and the tail is never reached.
Agencies are therefore collected first (~18k small records) and sorted
stalest-first — never-searched agencies before searched ones, oldest search
first — so each run advances the frontier.

Within an agency, the newest window year that has never been searched is chosen,
and only once every window year is cached does the newest year get re-searched.
That order finishes the backfill before spending runs on freshness, and still
picks up new uploads in the steady state.

## Mention extraction and the "definitive match" gate

`officerMentions` finds role-prefixed Title-case names in the title, description,
and captions. These are **candidates only**. "Definitively linked", per
ADR 0022/0023, means the intake-owned `resolvePersonnel(agencyId, personnelName)`
resolver matched exactly one existing officer on that agency's roster, inside its
own confidence floor and ambiguity band. The source never sees a canonical id and
never decides a match. Absent or ambiguous returns null, which yields no link.

The agency side needs no resolver: the envelope's agency came from the acquire
`agencies(...)` facade, so it already exists in the database by construction.
That is how "the officer's agency must also already be in the current database"
is satisfied structurally rather than by a check.

## Provenance that the published schema cannot hold

`CoverageLinkSpec` is `.strict()`: `url`, `normalized_url`, `title`,
`source_name`, `published_at`, `notes`. There is no column for channel id or
retrieval time. Rather than widen a shared published schema from a single-source
change, that provenance stays in the acquired evidence, which the repo already
treats as durable and auditable:

- `channel.json` — handle → resolved channel id
- `*.videos.json` — per-agency envelope with window, retrievedAt, and every
  video's channelId / publishedAt / canonical url
- `.api-calls.jsonl` — the raw API responses, unchanged

Widening `coverage_links` is a separate change and should be driven by what the
public page needs to render, across all coverage sources.

## What this change deliberately does not touch

`sources/youtube.policeactivity/` is left exactly as it is. It has the same
window-at-emit gap described above (its `mergedVideos` returns every cached year
regardless of the current floor, so an out-of-window video still emits), and it
should move onto the shared implementation. Both belong to INS-48, whose issue is
in progress; changing it here would collide with that work in a shared checkout.
