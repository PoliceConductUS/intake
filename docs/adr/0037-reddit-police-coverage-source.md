# ADR 0037: Reddit Police-Coverage Source

## Status

Proposed

> Models directly on the YouTube coverage source (`sources/youtube.policeactivity`,
> ADR 0022/0023): both link an external publisher's item to a specific officer at a
> specific agency and emit `CoverageLinks` + `CoverageLinkAgencyPersonnel`. This ADR
> is design-only — no code yet — because the officer-linking **confidence** is the
> whole risk and must be settled before implementation.

## Context

Reddit hosts a large, continuously-updated corpus of police-conduct discussion —
city subreddits reporting on local incidents, national subreddits aggregating
misconduct clips, threads naming specific officers. Anything we can **confidently**
tie to an officer already in our database (`agency_personnel`) is coverage, exactly
like a PoliceActivity YouTube video is.

The governing constraint is the project rule: **everything resolves to a specific
officer@agency or it is not added** ("nowhere to hide"). Reddit is the hardest input
we have for that rule:

- **No agency scope by default.** The YouTube source searches _per agency_ (a channel
  query per agency), so "Officer Smith" is resolved against that one agency's roster.
  A raw Reddit post that says "Officer Smith tased a guy" names no agency, and "Smith"
  matches thousands of officers nationwide — unresolvable.
- **Low reliability.** Reddit is rumor, allegation, and editorialized clips, not court
  records or a curated clearinghouse. The attributed-claim framing the YouTube source
  already uses (the publisher's framing is a claim; only the resolved link is a fact)
  applies here with more force.
- **Real people, often un-adjudicated.** Both the named officer and third parties in a
  thread are private individuals; the officer is frequently accused, not adjudicated.

So the question this ADR answers is not "can we fetch Reddit" (we can) but **"when is
a Reddit item confidently about a known officer, and never otherwise?"**

## Decision

A new source `sources/reddit.police` (name TBD) that emits **only** coverage links to
officers it resolves with high confidence — reusing the existing coverage model and
the existing fuzzy `agency_personnel` resolver. No new entity, no new resolver.

**1. Reuse the coverage kinds; add no schema.** `produces = ["CoverageLinks",
"CoverageLinkAgencyPersonnel"]`. Each accepted Reddit item becomes one `CoverageLink`
(the permalink URL, the post title, `source_name: "reddit"`, `published_at`) plus one
`CoverageLinkAgencyPersonnel` per resolved officer, carrying the resolver's
`confidence` and a `notes` citation to the naming passage. (CoverageLinkCivilCase is
out of scope for v1 — Reddit rarely cites a docket cleanly.)

**2. Agency scope is a precondition, not an afterthought — this is the confidence
crux.** An officer name is only resolved against a roster we have first scoped to one
agency. The scope comes from one of three signals, in order, and if none is present
the item is dropped:

- **Subreddit → agency** for city/region subreddits with a known local department
  (e.g. r/Austin → Austin PD). A curated `SUBREDDIT_AGENCY` map (small, explicit,
  fail-loud like other hand-lists) supplies this.
- **An agency/city named in the post** that `data.resolveAgency` resolves to exactly
  one agency (the same resolver the submissions/courtlistener sources use).
- Otherwise **drop** — a national subreddit post naming only "Officer Smith" has no
  resolvable scope and is never added.

**3. Resolve the name through the existing resolver, unchanged.** Within the scoped
agency, extract officer mentions with the shared role-prefix extractor
(`sources/lib`, the one the YouTube source uses — "Officer Smith", "Sgt. Jones") and
resolve each via `data.resolvePersonnel({ agencyId, personnelName })`, which already
enforces the name-confidence floor and the ambiguity band (attach to neither on a
tie). We do **not** add a new or looser matcher. An unresolved or ambiguous name
yields no link — the item may then produce zero links and is not added.

**4. acquire is the only non-deterministic step (ADR 0022).** acquire authenticates to
the Reddit API (OAuth script app, `REDDIT_*` env), pulls posts/comments from the
curated subreddit list within a time window, and writes scrubbed items (permalink,
title, self-text, created_utc, the scoping signal) to its source-local cache. No
Reddit **usernames** or other PII persist — only the public permalink, the post text
needed to cite the naming passage, and the derived agency scope. Rate limits and
retries mirror the CourtListener acquire's backoff. transform is pure over that cache.

**5. High bar, attributed framing, verbatim citation.** The Reddit text is an
_attributed claim_ (per the YouTube precedent): the fact we assert is only "this
public Reddit URL names this officer at this agency," cited in `notes` to the exact
naming passage, stored verbatim (never rewritten — ADR 0029/0030 ethos). The AI gate
that governs submissions is **not** in scope here; Reddit items are not published
narratives, they are coverage links behind a resolved officer.

**6. Curated subreddit list.** A committed, explicit list of the largest
police-related and large city subreddits (e.g. r/ProtectAndServe,
r/Bad_Cop_No_Donut, r/PoliceMisconduct, r/2020PoliceBrutality, plus city subreddits
that carry the agency scope). National subreddits contribute only when signal #2
resolves an agency from the post itself; the value concentrates in city subreddits
where signal #1 gives scope for free.

## Consequences

- **No migration, no new entity, no new resolver.** The source is additive: it plugs
  into the coverage model and the standard chain like YouTube does.
- **A new external dependency** (Reddit OAuth) and its rate limits, quarantined in
  acquire and cached.
- **A curated `SUBREDDIT_AGENCY` map** to maintain — an honest hand-list, fail-loud
  when a mapped subreddit's agency does not resolve.
- **Most national-subreddit content will be dropped** (no resolvable scope). That is
  the intended behavior, not a defect: better to add nothing than to guess an officer.
- **Gated behind the reconstruction rule** like every new source (seed.sql retired,
  full rebuild verified) — and after the officer roster is imported, so name
  resolution has something to resolve against.

## Alternatives Considered

- **Resolve names without agency scope (nationwide roster).** Rejected: "Officer
  Smith" against the national roster is never a unique match; it violates the
  resolve-to-a-specific-officer rule by construction.
- **A general NLP entity extractor over post text.** Rejected for v1: the shared
  role-prefix extractor already used for YouTube is predictable and auditable; a
  looser NER trades that for noise the confidence rule would just discard anyway.
- **A dedicated `reddit_post` entity.** Rejected: the thing of value is the officer
  link, which the coverage model already expresses; a new entity adds schema with no
  new capability.
- **Comment-tree ingestion.** Deferred: v1 takes post titles + self-text; comment
  threads multiply PII and noise for marginal additional resolvable links.

## Revisit Trigger

Reddit API terms or pricing change enough to threaten access; the confidence rule
proves too strict (almost nothing resolves) or too loose (wrong-officer links appear
in review), either of which is a signal to revisit the scoping signals in Decision 2;
or a second attributed-claim media source appears and the extractor/scoping logic
wants to move to a shared coverage library.
