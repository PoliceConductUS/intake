# Design

## Channel identity

Resolved 2026-10-24: `https://www.youtube.com/@AuditTheAudit` carries
`<meta itemprop="identifier" content="UCc-0YpRpqgA5lPTpSQ5uo-Q">`,
`og:url = https://www.youtube.com/channel/UCc-0YpRpqgA5lPTpSQ5uo-Q`, and the title
"Audit the Audit". Round-tripped by retrieving
`https://www.youtube.com/channel/UCc-0YpRpqgA5lPTpSQ5uo-Q`, which reports
`vanityChannelUrl = http://www.youtube.com/@AuditTheAudit`. Both retrievals are
robots-permitted (`https://www.youtube.com/robots.txt` disallows `/api/`,
`/results`, `/feeds/videos.xml` and others, but not a channel or handle page).

The id is checked in; the handle is provenance. Acquire re-resolves the handle
through `channels.list?forHandle=` on every run and stops when it answers with a
different id — a reassigned handle must not quietly redirect this source at
someone else's channel.

## Where the five-year window is computed

`config-driven-source-import` requires the deterministic phase to be independent
of wall-clock time, and the board requires the period to roll with each run. Both
hold by splitting them:

- `acquire` computes `rollingWindow(new Date())` once per run, uses it to bound
  every search, and writes it into `channel.json` and every
  `<agency>.<agency-id>.videos.json` envelope alongside `retrievedAt`.
- `transform` reads the window out of the evidence and emits links only for
  videos inside it. Same evidence in, same records out — and the window still
  moves, because the next acquisition rewrites it.

An envelope with no window is a failure, not a default: without it the period
cannot be applied, and a link that cannot be checked must not be produced.

`isInWindow` requires an ISO 8601 instant. `Date.parse` alone accepts
"sometime in 2024" as 2024-01-01; a video whose publication time cannot be read
exactly does not qualify.

## One search per agency per run, oldest year last

Searching is the expensive call (100 quota units each), so a run makes one search
per agency: the newest window year that agency has never been searched for, and
once all of them are searched, the open year again — the only year that can still
gain uploads. Year bounds are clamped to the window, so the oldest and newest
years are searched only over the part of them inside it.

Cached years the window has rolled past are pruned; everything still inside it is
kept. That cache is what makes reconsideration automatic: a video with no
resolvable officer today stays in the evidence and is re-resolved on every later
run until the window passes it.

## The cache is keyed by agency source id, not agency name

"Springfield Police Department" exists in more than one state. A name-keyed cache
or evidence file would merge two agencies' videos and attribute one agency's
footage to the other's officers — a wrong claim about a named person. The cache
key is the agency's namespace-local source id, and the evidence file name carries
both the readable slug and that id.

## No captions

`youtube.policeactivity` enriches each video with the `/api/timedtext` caption
track. This source does not: `https://www.youtube.com/robots.txt` disallows
`/api/`, and this organization does not fetch paths a source's robots.txt
disallows. Officer candidates therefore come from the Data API `snippet` title and
description only.

Acquire injects a `fetchText` that throws, so caption access is refused rather
than merely unused and cannot be reached by a later edit. Removing
`fetchCaptions` from the shared client belongs to PR #76 (INS-48), which is
already doing it; this change does not touch it.

The cost is coverage, not accuracy: fewer videos name a resolvable officer. The
rolling window means nothing is permanently lost — if caption access is later
obtained on terms that permit it, a re-run picks up the additional matches for
every video still inside the window.

## What the link carries

`coverage_links` has `url`, `normalized_url`, `title`, `source_name`,
`published_at` (a date) and `notes`. The emitted link carries the canonical watch
URL, the title, `source_name: "Audit the Audit"`, the publication date, and the
publisher's description in `notes` as an attributed claim — the channel's framing
is never a fact of ours. Each `coverage_link_agency_personnel` row carries the
passage that names the officer, at `confidence: "named-in-video"`.

The full publication timestamp, the channel id, the retrieval time, and the
search that found the video stay in the acquired evidence envelope and the
`.api-calls.jsonl` log, which is the source's provenance record.

## Deliberate limitations

- `searchChannelVideos` reads one page (up to 50 hits) per agency-year and
  ignores `nextPageToken`; an agency-year with more than 50 matching videos is
  truncated. Shared with the first channel; raising it costs quota, not accuracy.
- A video deleted or made private upstream disappears from a refreshed year and
  stops producing a link. No delete mutation is emitted (the pipeline does not
  delete on absence), and explicit source-state records for disappearance remain
  unbuilt for both channels.
