# Tasks

> First cut landed: the officer-link path (acquire per-agency search → run
> resolves officers → CoverageLink + CoverageLinkAgencyPersonnel) with unit tests.
> Remaining: per-video source-state diffing (1.4), acquire-orchestration tests
> (3.1), and the deferred case-link path (2.4). Live acquire needs `YOUTUBE_API_KEY`.

## 1. Source scaffold + acquire (per-agency channel search)

- [x] 1.1 `sources/youtube.policeactivity/run.ts` exports `run`, `produces`
      (CoverageLinks, CoverageLinkAgencyPersonnel), `description`.
- [x] 1.2 Shared client `sources/lib/youtube.ts`: resolve `@PoliceActivity` →
      channel id; `search?channelId=…&q=…&type=video`; captions (timedtext).
      `YOUTUBE_API_KEY` from env; added to `.env.example`.
- [x] 1.3 `acquire.ts`: page agencies via `data.agencies({ minOfficers })`; per
      agency search the channel by name/place; store each hit's video + captions
      **stamped with the agency source id** as raw evidence; per-agency cache.
- [ ] 1.4 Explicit source-state records for deleted/private/changed videos
      (search omits unavailable videos; detecting ones that disappeared vs. a
      prior cache is not yet implemented). Cache makes re-runs idempotent.

## 2. Run: resolve officers at the known agency + emit cited links

- [x] 2.1 Officer-name candidate extraction from title+description+captions
      (`(?i:role)` prefix + Title-case name; gated by `isPersonName`).
- [x] 2.2 Per video at its acquired agency, resolve each named officer via
      `resolvePersonnel`; emit CoverageLink + CoverageLinkAgencyPersonnel for
      resolved officers, each with the naming passage in `notes`.
- [x] 2.3 A video with no verified link emits no durable coverage record;
      `run()` is deterministic (no network/clock/randomness).
- [ ] 2.4 (Deferred) Case links: a match-only `resolveCivilCase` run capability,
      then docket → existing CivilCase → CoverageLinkCivilCase.

## 3. Tests + validation

- [ ] 3.1 Acquire-orchestration tests (fixtures): per-agency loop, agency-stamped
      files, cache/idempotency. (The YouTube client — search/pagination/captions/
      channel-id — is unit-tested in `test/sources/lib/youtube.test.ts`.)
- [x] 3.2 Run tests (fixtures): supported officer link emitted with citation;
      unresolvable/unnamed video → no link; determinism.
- [x] 3.3 `npm run openspec:validate` and the narrow source tests pass.
