## Context

The board supplied an ordered list of YouTube channels covering policing, ranked
by subscriber count, and asked for rank 1 (Donut Operator, `@DonutOperator`,
`UCwkm_Wcyh0pc7UUmZZfL-6w`, ~5.31M subscribers on 2026-08-24) to land as an
intake source. The existing `sources/<namespace>` contract already provides
everything needed structurally: an optional `acquire` phase for network work, a
deterministic `run` phase, a declared `produces` set, and an `Artifacts` envelope
that root intake validates record by record.

The open questions were not mechanical. They were: what entity does a video
become, what is the record's identity, and where does this source stop.

## Decisions

**Namespace per channel, reverse-DNS: `com.youtube.donutoperator`.**
The queue is ranked by channel, and channels differ in editorial character,
reliability, and access terms. A shared `youtube` namespace would fuse them into
one provenance blob and make a per-channel takedown or suppression a filtering
exercise. Per-channel namespaces make rank 2..n purely additive and keep the
source-name ledger scoped the way ADR 0015 intends. Reverse-DNS matches
`gov.tx.tcole` and the sibling producer repos.

**A video is a `CoverageLink`, keyed by video ID.**
`coverage_links` already models exactly this — a URL, a normalized URL, a title,
a publication name, a publish date — and `CoverageLinks` is registered with
`dependsOn: []`, so this source needs no pipeline change and no new kind. The
YouTube video ID is globally unique and permanent, which makes it both the
source-local record key and the basis for `normalized_url`. Building the URL
from the ID rather than passing through whatever URL form the API returned means
there is no share-link, playlist-context, or tracking-parameter variance for the
`coverage_links_normalized_url_key` unique index to trip over.

`contentDetails.videoPublishedAt` is the publish time; `snippet.publishedAt` on a
playlist item is when the video was _added to the uploads playlist_. They are
usually close and occasionally are not. `published_at` takes the former.

**The source stops at the coverage record.**
The tempting next step is to attach each video to the officer it discusses. This
source cannot do that correctly: YouTube gives it a stable ID for the _video_ and
nothing at all for the _person_, so any link would come from matching a name out
of a title or description written for an audience, not a records system. A wrong
attachment here is a claim that a named officer was the subject of a named piece
of commentary — the exact failure mode the project treats as unacceptable.

Rather than leave that as a comment, the constraint is enforced by the contract
already in place: `produces: ["CoverageLinks"]`, and `runSource` aborts on any
emitted kind not in `produces`. Emitting `CoverageLinkAgencyOfficers` from this
namespace is a failed run.

**Identity checks run in both phases.**
`acquire` verifies the channel ID against `channels.list`; `run` re-verifies the
acquired `channel.json` and every playlist item's `snippet.channelId`. The second
check is not redundant: archived snapshots are replayable without `acquire`, and
the identity guarantee has to survive that path. Handle and title drift is logged
and recorded instead — those are labels, and a rename is information, not a fault.

## Alternatives Considered

- **A generic `youtube` source parameterized by a channel list.** Rejected for
  now: one channel is in scope, and a per-channel namespace is the unit the
  ranking, provenance, and any future suppression actually operate on. If ranks
  2..n prove to be pure copies, the shared logic can be lifted into
  `sources/lib/` the way `civil-defendants.ts` was — without collapsing the
  namespaces.
- **Emitting officer links behind a confidence field.** Rejected. The
  `coverage_link_agency_officers.confidence` column exists, but a low-confidence
  value on a wrong row is still a wrong row, and nothing downstream is obliged to
  read it. The gate belongs at emission.
- **Scraping the channel page or an RSS feed to avoid the API key.** Rejected.
  YouTube's terms prohibit scraping, and the Data API is free within the default
  quota — a full channel re-pull costs one unit per 50-item page against a
  10,000-unit daily budget. There is no reason to take the disallowed path.
- **Ingesting video descriptions and transcripts as record text.** Out of scope.
  That is third-party commentary about named people; storing it as a field on our
  records is a publication-risk decision, not an engineering one.

## Risks / Open Questions

- **The channel ID is board-supplied and has not been verified against YouTube.**
  Verification requires a `YOUTUBE_API_KEY`, which is not yet provisioned, so the
  first `acquire` is the check — and it fails loudly if `channels.list` does not
  return exactly that channel.
- **Refresh policy is unspecified.** Each `acquire` writes a full snapshot with
  its own digest; how often a channel is re-pulled, and whether an upload that
  disappears from the playlist should be suppressed rather than simply absent
  from the next run, is not decided here.
- **Whether this coverage is ever publicly rendered is not an engineering call.**
  Nothing in this change publishes anything.
