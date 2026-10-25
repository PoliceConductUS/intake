# Tasks

## 1. Channel configuration and shared library

- [x] 1.1 `sources/youtube.audittheaudit/channel.ts`: the pinned channel id
      `UCc-0YpRpqgA5lPTpSQ5uo-Q`, the handle, and the publisher name, with the
      resolution evidence recorded (see `design.md`).
- [x] 1.2 Add `sources/lib/youtube-data-api-fetch.ts` (keyed, retrying,
      quota-stopping, audit-logged Data API fetch) and
      `sources/lib/officer-mentions.ts` (candidate officer names + supporting
      passage) as shared files with unit tests, so the remaining channel ranks
      share one retry policy and one reading of "this text names an officer".
- [x] 1.3 Refuse caption access by injecting a `fetchText` that throws
      (`/api/timedtext` is robots-disallowed). Removing `fetchCaptions` from the
      shared client is PR #76's (INS-48) change, not this one's.

## 2. Acquire: rolling window, per-agency channel search

- [x] 2.1 `rolling-window.ts`: the five years ending at the run, the window years
      newest-first, per-year search bounds clamped to the window, and an
      ISO-instant window test.
- [x] 2.2 `video-cache.ts`: per-agency/per-year cache keyed by the agency's
      source id, pruned to the window, backfilling the newest unsearched year and
      then re-searching the open year.
- [x] 2.3 `acquire.ts`: require `YOUTUBE_API_KEY`; re-resolve the handle and fail
      on a different channel id; record channel, window, and `retrievedAt`;
      search per agency; store each hit's snippet stamped with the agency source
      id; stop the run on quota; skip a failed agency visibly and uncached.

## 3. Transform: definite links only

- [x] 3.1 Fail without a data context; fail on evidence with no window or from
      another channel.
- [x] 3.2 Emit `CoverageLinks` + `CoverageLinkAgencyPersonnel` only for in-window
      videos naming an officer that resolves at the acquired agency, citing the
      naming passage; emit nothing for out-of-window, unmatched, or ambiguous
      videos; create no officer or agency.
- [x] 3.3 Keyed by the stable YouTube video id, so an unchanged source and
      database state re-import the same records rather than new ones.

## 4. Tests and validation

- [x] 4.1 `test/sources/lib/officer-mentions.test.ts`,
      `test/sources/lib/youtube-data-api-fetch.test.ts` (retry, give-up, quota,
      audit log, keying).
- [x] 4.2 `test/sources/youtube.audittheaudit/rolling-window.test.ts`,
      `video-cache.test.ts`.
- [x] 4.3 `test/sources/youtube.audittheaudit/acquire.test.ts`: window bounds in
      the search, channel-id enforcement, agency-stamped evidence, same-named
      agencies kept apart, year backfill, re-run without duplication, visible
      agency skip, quota stop, Data-API-only access.
- [x] 4.4 `test/sources/youtube.audittheaudit/transform.test.ts`: the board's
      acceptance criteria, including a previously skipped video picked up once
      the officer exists.
- [x] 4.5 `npm run validate` (format, typecheck, vitest, build, openspec).

## 5. Open, not in this change

- [ ] 5.1 Explicit source-state records for videos deleted or made private
      upstream (shared gap with `youtube.policeactivity`).
- [ ] 5.2 Point `youtube.policeactivity` at the two new shared files and delete
      its local copies, once PR #76 (INS-48) has finished rewriting it.
