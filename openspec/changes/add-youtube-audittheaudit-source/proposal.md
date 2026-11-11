## Why

Audit the Audit is rank 5 of the board's six subscriber-ordered YouTube intake
sources (INS-51). It reviews recorded police encounters, naming agencies and
officers in its titles and descriptions — coverage that belongs on records we
already hold, as a cited link, and nowhere else.

The board set this source's terms, and they are narrower than the first channel's
(`youtube.policeactivity`):

- only videos published inside the **rolling five-year period ending at the run**
  qualify;
- a video qualifies only when it links **definitively** to an officer already in
  the database **and** to that officer's agency, also already in the database;
- a video never creates an officer or an agency;
- an absent or ambiguous match is **skipped for this run and reconsidered on
  every later run** while the video stays inside the window;
- links only — no video media is ingested or stored.

## What Changes

**New source `sources/youtube.audittheaudit/` (acquire + transform)**

- From: no intake path for this channel.
- To: `acquire.ts` resolves the channel, computes the rolling five-year window
  once, pages agencies through the `data.agencies({ minOfficers: 1 })` facade,
  and searches **within the channel** per agency over one window year per run,
  storing each hit's Data API snippet stamped with the agency's source id, the
  channel id, the window, and the retrieval time. `transform.ts` reads that
  evidence and emits `CoverageLinks` + `CoverageLinkAgencyPersonnel` only for
  in-window videos that resolve to an existing officer at that agency.
- Reason: the agency is fixed by the search, so the officer resolves against that
  agency's roster alone — the "officer and agency both already exist" rule holds
  by construction rather than by a later check.
- Impact: additive namespace `youtube.audittheaudit`; no schema change, no new
  env var (`YOUTUBE_API_KEY`, already documented), no new record kind.

**Channel identity is pinned, not looked up**

- The source stores the stable channel id `UCc-0YpRpqgA5lPTpSQ5uo-Q`. Acquire
  re-resolves `@AuditTheAudit` through the Data API every run and **fails** when
  the handle no longer answers with that id, because a handle can be released and
  reassigned to someone else. Every search is by channel id, and every stored and
  re-read video is checked against it.

**The window is acquired, not assumed**

- Acquire owns wall-clock time and records the window it used; `transform` applies
  the window from the evidence it reads. The transform therefore stays
  deterministic for its inputs (`config-driven-source-import`) while the period
  still rolls with each acquisition.

**Additive only**

- `sources/lib/youtube-data-api-fetch.ts` (keyed, retrying, quota-stopping,
  audit-logged Data API fetch) and `sources/lib/officer-mentions.ts` (officer-name
  candidates with the passage that supports each) are new shared files, carrying
  the retry policy and the name reading that every channel source needs so the
  remaining ranks cannot each drift into their own.
- This change modifies **no existing file**. `youtube.policeactivity` still holds
  its own copies of both, and PR #76 (INS-48) is rewriting that source right now;
  whoever merges second should delete the local copies and point it at
  `sources/lib/`. Captions are untouched here for the same reason — PR #76 removes
  `fetchCaptions` from the shared client, and this source simply refuses caption
  access (see `design.md`).

## Non-Goals

- Captions. This source reads the Data API snippet only — see `design.md`.
- Case links. `CoverageLinkCivilCase` stays out of this source.
- Source-state diffing for videos that disappear upstream (shared gap with
  `youtube.policeactivity`, tracked there).
