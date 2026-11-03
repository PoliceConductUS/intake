## Why

Accountability YouTube channels document real police interactions that name real
officers, agencies, and cases — coverage the database has no way to ingest today.
Issue #52 asks for this as one source per channel. PoliceActivity (#64, INS-48) is
the first: it publishes incident footage with agency- and incident-specific
descriptions, so it is a good first target for turning a video into a **cited,
verified coverage link** on records we already have.

The hard rule (from #52): the channel's framing is an _attributed claim_, never a
canonical fact, and the importer **never guesses** an officer or agency. A video
becomes a durable coverage link only when it resolves to an **existing** officer
at an **existing** agency, with the supporting passage cited. No new agencies or
personnel are ever minted from a video.

## What Changes

**Source `sources/youtube.policeactivity/` (acquire + produce)**

- From: no way to ingest video coverage; `coverage_links` is populated only by
  mn-post.
- To: mirroring clearinghouse-api / courtlistener, `acquire.ts` pages agencies via
  the `data.agencies(...)` facade and searches the PoliceActivity channel **per
  agency** (YouTube Data API v3, keyed), storing each hit stamped with the
  agency's source id; `transform.ts` reads them and, for each video at that known
  agency, resolves officers to existing records and emits CoverageLink +
  CoverageLinkAgencyPersonnel for verified links only.
- Reason: ingest accountability-video coverage as cited links on existing data,
  reusing the per-agency-search boundary CH/CL already established.
- Impact: additive namespace `youtube.policeactivity`; no schema change (uses the
  CoverageLink kinds). No new produce capability — the agency is known from
  acquire (ADR 0023), so `resolvePersonnel` suffices and no agency-from-text
  resolver is introduced.

**Declared configuration, no environment knobs** (INS-48)

- `channel.ts` declares the channel handle/URL, the `source_name`, and the
  five-year window length. `YOUTUBE_MIN_YEAR` is removed: the window is the
  source's behavior, not an operator setting, and its old default (the current
  year only) silently ingested a 1-year window in production.

**One stable channel identity** (INS-48)

- The handle is resolved to the stable channel id, persisted in the source's
  state, and asserted on every later run. A handle that starts resolving to a
  different channel halts the run instead of mixing two channels' videos under
  one namespace.

**Rolling five-year window, applied end to end** (INS-48)

- Each run considers only videos published in the five years ending at that run.
  Acquire clips every search to the window and stamps it on the evidence; the
  deterministic produce phase filters against that stamp. Previously the produce
  phase applied no window at all, so any cached video could still emit a link.
- A video that matched nothing stays in the evidence and is re-resolved against
  the current database on every later run, so it becomes a link automatically once
  the officer and agency exist — and stops being considered when it ages out.
- Once an agency's covered years are backfilled, the window's end year is
  re-searched each run; previously a fully backfilled agency was never searched
  again and new uploads were never seen.

**Data API only — no `robots.txt`-disallowed fetch** (INS-48)

- `youtube.com/robots.txt` has `Disallow: /api/`. The caption fetch shipped in #59
  used `https://www.youtube.com/api/timedtext`, inside that disallowed prefix, so
  it is removed: candidate officer names now come from the title and description
  only. This narrows recall and that is the correct trade — we do not fetch a path
  a source disallows. No media is requested or stored.

**Env**

- `YOUTUBE_API_KEY` (acquire only) — documented in `.env.example`.
- `YOUTUBE_MIN_YEAR` — removed.
