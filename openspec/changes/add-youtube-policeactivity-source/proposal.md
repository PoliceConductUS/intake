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
- To: `acquire.ts` fetches the PoliceActivity channel's videos and captions via
  the YouTube Data API v3 (keyed) into `sourceDir` as raw evidence; `run.ts`
  reads them, resolves each video to existing records, and emits CoverageLink +
  CoverageLinkAgencyPersonnel + CoverageLinkCivilCase for verified links only.
- Reason: ingest accountability-video coverage as cited links on existing data.
- Impact: additive namespace `youtube.policeactivity`; no schema change (uses the
  CoverageLink kinds, including the just-added CoverageLinkCivilCase).

**New run capability: resolve an agency by name (match-only)**

- From: `RunDataContext` exposes only `resolvePersonnel({agencyId, personnelName})`
  — it assumes the source already knows the agency (CH/CL acquire per agency).
- To: add `resolveAgency({name, state?}) → { agencyId } | null` — an intake-owned,
  match-only resolver that maps a name to an **existing** agency's namespace-local
  id or returns null. Never mints. A video names its agency in text, not by id.
- Reason: video coverage is not acquired per agency, so the agency must be
  resolved from the cited passage before its personnel can be.
- Impact: additive to the ADR 0023 run boundary; source ids only cross it.

**Attributed-claim separation**

- The video's title/description/commentary are stored on the CoverageLink as the
  publisher's framing; only the resolved links (officer, agency, case) are facts,
  each carrying the source passage/timestamp that supports it.

**Env**

- `YOUTUBE_API_KEY` (acquire only) — documented in `.env.example`.
