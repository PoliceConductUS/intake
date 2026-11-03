# Tasks

> Landed: the full eligibility contract (pinned channel → rolling five-year window
> → officer resolution at the acquired agency → CoverageLink +
> CoverageLinkAgencyPersonnel) with unit tests. A live `acquire` still needs
> `YOUTUBE_API_KEY` (INS-53), which is also the first real check of the pinned
> channel id.

## 1. Source scaffold + acquire

- [x] 1.1 `sources/youtube.donutoperator/channel.ts`: pinned handle and channel
      id, `WINDOW_YEARS`, window arithmetic, run clock.
- [x] 1.2 `acquire.ts`: resolve the handle and assert it equals the pinned id;
      page agencies via `data.agencies({ minOfficers: 1 })`; search the channel
      per agency-year inside the window; store hits stamped with the agency
      source id; drop hits from any other channel.
- [x] 1.3 `video-cache.ts`: per-agency per-year cache; backfill-before-refresh
      scheduling; prune years that fall out of the window; stable merge.
- [x] 1.4 Quota handling reused from `sources/lib/youtube.ts` — 403/429 quota
      halts the run (resumes next run); other single-agency failures are logged,
      skipped, and left uncached so a later run retries.
- [ ] 1.5 Explicit source-state records for deleted/private/changed videos
      (search omits unavailable videos; diffing them against a prior cache is not
      implemented). Shared with the sibling source's open 1.4.
- [ ] 1.6 Acquire-orchestration tests (two-pass scheduling, envelope writing)
      against a fake YouTube API and agencies facade.

## 2. Transform (eligibility + linking)

- [x] 2.1 `transform.ts` exports `transform`, `produces` (CoverageLinks,
      CoverageLinkAgencyPersonnel), `description`.
- [x] 2.2 Re-apply the rolling window per video at emit time.
- [x] 2.3 Resolve candidate names via `data.resolvePersonnel` scoped to the
      acquired agency; emit nothing when none resolves.
- [x] 2.4 Emit `CoverageLink` keyed by video id and
      `CoverageLinkAgencyPersonnel` keyed by `videoId|agencyPersonnelId`, each
      officer link citing its naming passage.
- [x] 2.5 Count and log every exclusion reason, so "nothing emitted" is
      distinguishable from "nothing considered".
- [ ] 2.6 Case links (`CoverageLinkCivilCase`) — deferred with the sibling's,
      gated on a match-only `resolveCivilCase` capability.

## 3. Shared heuristic

- [x] 3.1 Extract the candidate-name regex to `sources/lib/officer-mentions.ts`
      with its own tests; `youtube.policeactivity` now imports it.

## 4. Tests + docs

- [x] 4.1 `test/sources/youtube.donutoperator/channel.test.ts` — window edges,
      lenient-date rejection, run-clock pinning.
- [x] 4.2 `test/sources/youtube.donutoperator/video-cache.test.ts` — backfill vs
      refresh scheduling, pruning, stable merge.
- [x] 4.3 `test/sources/youtube.donutoperator/transform.test.ts` — every
      acceptance criterion: linked, out of window, unnamed, unresolved, wrong
      channel, skipped-then-picked-up, and re-run determinism.
- [x] 4.4 `test/sources/lib/officer-mentions.test.ts`.
- [x] 4.5 `.env.example`: `YOUTUBE_WINDOW_NOW`, and a note that
      `YOUTUBE_MIN_YEAR` does not apply to this source.

## 5. Gated — not this change

- [ ] 5.1 Verify the pinned channel id against YouTube (INS-53: provision
      `YOUTUBE_API_KEY`). On a mismatch, stop and re-verify the whole ranked
      channel list rather than re-pinning.
- [ ] 5.2 Public visibility of officer-attached coverage — blocked on the Data
      Integrity & Publication Risk Reviewer gate.
