# Tasks

> First cut landed: the officer-link path (acquire per-agency search → run
> resolves officers → CoverageLink + CoverageLinkAgencyPersonnel) with unit tests.
> Remaining: per-video source-state diffing (1.4), acquire-orchestration tests
> (3.1), and the deferred case-link path (2.4). Live acquire needs `YOUTUBE_API_KEY`.

## 1. Source scaffold + acquire (per-agency channel search)

- [x] 1.1 `sources/youtube.policeactivity/run.ts` exports `run`, `produces`
      (CoverageLinks, CoverageLinkAgencyPersonnel), `description`.
- [x] 1.2 Shared client `sources/lib/youtube.ts`: resolve `@PoliceActivity` →
      channel id; `search?channelId=…&q=…&type=video`. No caption request.
      `YOUTUBE_API_KEY` from env; added to `.env.example`.
- [x] 1.3 `acquire.ts`: page agencies via `data.agencies({ minOfficers })`; per
      agency search the channel by name/place; store each hit's video
      **stamped with the agency source id** as raw evidence; per-agency cache.
- [ ] 1.4 Explicit source-state records for deleted/private/changed videos
      (search omits unavailable videos; detecting ones that disappeared vs. a
      prior cache is not yet implemented). Cache makes re-runs idempotent.

## 2. Run: resolve officers at the known agency + emit cited links

- [x] 2.1 Officer-name candidate extraction from title+description
      (`(?i:role)` prefix + Title-case name; gated by `isPersonName`).
- [x] 2.2 Per video at its acquired agency, resolve each named officer via
      `resolvePersonnel`; emit CoverageLink + CoverageLinkAgencyPersonnel for
      resolved officers, each with the naming passage in `notes`.
- [x] 2.3 A video with no verified link emits no durable coverage record;
      `run()` is deterministic (no network/clock/randomness).
- [x] 2.4 Case links (officer-gated): a match-only `resolveCivilCase` run
      capability; docket tokens → existing CivilCase (unique match) →
      CoverageLinkCivilCase, only for videos that already matched an officer.
      `CoverageLinkCivilCase.civil_case_id` passes the natural key through at
      import (cross-source reference, ADR 0023/0028).

## 3. Tests + validation

- [ ] 3.1 Acquire-orchestration tests (fixtures): per-agency loop, agency-stamped
      files, cache/idempotency. (The YouTube client — search/pagination/
      channel-id — is unit-tested in `test/sources/lib/youtube.test.ts`.)
- [x] 3.2 Run tests (fixtures): supported officer link emitted with citation;
      unresolvable/unnamed video → no link; determinism.
- [x] 3.3 `npm run openspec:validate` and the narrow source tests pass.

## 4. Captions are never fetched

- [x] 4.1 Remove the timedtext caption request: `youtube.ts:YoutubeApi` has no
      `fetchCaptions` and `createYoutubeApi` takes only `fetchJson`; acquire
      saves no `captions`/`captionsError` and logs no caption counts.
- [x] 4.2 Transform reads officer mentions from title and description only.
- [x] 4.3 Tests: every acquire request goes to `www.googleapis.com` and a saved
      video holds no caption field; caption text a video file still holds
      links no officer.
