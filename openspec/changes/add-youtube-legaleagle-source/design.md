# Design

## The axis that varies

Six channels, one behavior. `ChannelSourceConfig` is the whole difference:

```ts
type ChannelSourceConfig = {
  namespace: string; // for log lines and error messages only
  channelId: string; // "UCpa-Zb0ZcQjTCPP1Dx_1M8Q" — the source's identity
  handle: string; // "@LegalEagle" — provenance only, never used to select
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

## Why the channel id is pinned

The channel id is the source's identity, checked into the config and verified at
run time through `channels.list?id=`. It is deliberately **not** resolved from
the handle.

A handle can be renamed, or released and claimed by someone else, or transferred
to a different channel. A source that resolves `@LegalEagle` at run time would
follow that change silently and start attributing another channel's videos to
LegalEagle — producing wrong provenance on claims about named officers, with no
error anywhere. An id cannot move. So acquire verifies the pinned id, scopes every
search to it, and fails loudly if it returns no channel; drift between the
configured handle and the live one is logged as provenance, never acted on. The
transform re-checks each video's `channelId` against the pin, so the guarantee
also survives a replay where acquire never ran.

**The id, and how it was established.** `UCpa-Zb0ZcQjTCPP1Dx_1M8Q`, resolved
2026-10-24. The board gave the channel as `https://www.youtube.com/c/LegalEagle`,
a legacy `/c/` custom URL rather than a handle, which left open whether it and
`@LegalEagle` are the same channel — they are different namespaces in YouTube's
API. Both URLs serve
`<link rel="canonical" href="https://www.youtube.com/channel/UCpa-Zb0ZcQjTCPP1Dx_1M8Q">`
and `"externalId":"UCpa-Zb0ZcQjTCPP1Dx_1M8Q"`, both titled "LegalEagle", so the
question is settled by evidence rather than left as an assumption. Channel pages
are outside the `Disallow: /api/` prefix in `youtube.com/robots.txt`, so reading
one is permitted; the first keyed run re-verifies the id against the Data API
anyway.

## Why there are no captions

`youtube.com/robots.txt` carries `Disallow: /api/`. The only third-party
transcript endpoint, `youtube.com/api/timedtext`, sits inside that prefix, so
fetching it breaches our own rule against retrieving paths a source's robots.txt
disallows. The Data API's `captions.download` requires OAuth as the channel
owner, so there is no sanctioned transcript path for someone else's channel at
all.

Officer-name candidates therefore come from the **title and description only**.
This costs real recall: an officer's name is more often spoken than written,
particularly on commentary channels whose titles are editorial ("Real lawyer
reacts to..."). Fewer videos will reach a definitive match. That is the correct
trade — a video we cannot definitively match should produce no link — and it is
not a decision that needed escalating, because the robots.txt directive is
unambiguous.

The acquired video record carries no caption field at all, so there is nothing to
re-enable. A test asserts that every request this source makes goes to
`www.googleapis.com` and that none is under `/api/`.

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
