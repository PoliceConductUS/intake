## Why

Accountability YouTube channels document real police interactions that name real
officers, agencies, and cases — coverage the database has no way to ingest today.
Issue #52 asks for this as one source per channel. PoliceActivity (#64) is the
first: it publishes incident footage with agency- and incident-specific
descriptions, so it is a good first target for turning a video into a **cited,
verified coverage link** on records we already have.

The hard rule (from #52): the channel's framing is an _attributed claim_, never a
canonical fact, and the importer **never guesses** an officer or agency. A video
becomes a durable coverage link only when it resolves to an **existing** officer,
agency, or case, with the supporting passage cited. No new agencies or personnel
are ever minted from a video.

## What Changes

**New source `sources/youtube.policeactivity/` (acquire + run)**

- From: no way to ingest video coverage; `coverage_links` is populated only by
  mn-post.
- To: mirroring clearinghouse-api / courtlistener, `acquire.ts` pages agencies
  via the `data.agencies(...)` facade and searches the PoliceActivity channel
  **per agency** (YouTube Data API v3, keyed), storing each hit's video + captions
  stamped with the agency's source id; `run.ts` reads them and, for each video at
  that known agency, resolves officers (and any docketed case) to existing records
  and emits CoverageLink + CoverageLinkAgencyPersonnel + CoverageLinkCivilCase for
  verified links only.
- Reason: ingest accountability-video coverage as cited links on existing data,
  reusing the per-agency-search boundary CH/CL already established.
- Impact: additive namespace `youtube.policeactivity`; no schema change (uses the
  CoverageLink kinds, including the just-added CoverageLinkCivilCase). No new run
  capability — the agency is known from acquire (ADR 0023), so `resolvePersonnel`
  suffices and no agency-from-text resolver is introduced.

**Attributed-claim separation**

- The video's title/description/commentary are stored on the CoverageLink as the
  publisher's framing; only the resolved links (officer, agency, case) are facts,
  each carrying the source passage/timestamp that supports it.

**Env**

- `YOUTUBE_API_KEY` (acquire only) — documented in `.env.example`.
