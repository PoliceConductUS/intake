# Tasks

## 1. Channel-agnostic extraction (behavior-preserving)

- [x] 1.1 `sources/lib/youtube.ts`: add `fetchChannelById` (select a channel by
      immutable id via `channels.list?id=`, returning id/handle/title) and
      `createKeyedYoutubeFetchers` (the keyed Data API fetch with capped 429/5xx
      backoff, quota halt, and the raw-response `.api-calls.jsonl` log).
- [x] 1.2 `sources/lib/youtube-video-cache.ts`: the per-agency-year search cache,
      generic over the cached video payload (moved from
      `sources/youtube.policeactivity/video-cache.ts`).
- [x] 1.3 `sources/lib/youtube-coverage.ts`: officer-mention extraction and URL
      normalization (moved from `sources/youtube.policeactivity/transform.ts`).
- [x] 1.4 Rewire `youtube.policeactivity` onto 1.1–1.3 with no observable
      behavior change; its existing tests are the guard.

## 2. Source scaffold + acquire

- [x] 2.1 `sources/youtube.lawandcrime/channel.ts`: pinned channel id
      `UCz8K1occVvDTYDfFo7N5EZw`, handle `@LawAndCrime`, source name
      `Law&Crime Network`, the five-year window length, and the pure
      `publicationWindow(now)` / `isInWindow(publishedAt, window)` helpers.
- [x] 2.2 `acquire.ts`: require `YOUTUBE_API_KEY`; verify the pinned channel id
      and write `channel.json`; page agencies via `data.agencies({ minOfficers })`;
      per agency search the channel by name/place for the newest not-yet-searched
      year inside the window; cache one agency-year per search; write each
      agency's envelope from the full in-window cache, stamped with the agency
      source id, the channel id, and the declared window.
- [x] 2.3 Drop cache entries and envelope videos that have aged out of the
      window; issue no caption request.

## 3. Transform: resolve officers at the acquired agency and emit cited links

- [x] 3.1 Re-verify the archived channel id and every video's `channelId`; fail
      loudly on a foreign channel.
- [x] 3.2 Per video, resolve each named officer via `resolvePersonnel`; emit
      `CoverageLinks` keyed by video id and `CoverageLinkAgencyPersonnel` keyed by
      video id + officer, each citing the naming passage.
- [x] 3.3 Emit nothing for a video with no definitive match; stay deterministic
      (no network, clock, or randomness).

## 4. Tests + validation

- [x] 4.1 `test/sources/youtube.lawandcrime/channel.test.ts`: window arithmetic,
      in/out-of-window boundaries.
- [x] 4.2 `test/sources/youtube.lawandcrime/acquire.test.ts` (fakes): pinned-id
      verification and failure, window-bounded search requests, envelope
      provenance, aged-out pruning, no caption request, cached agency-year
      re-written without a second search.
- [x] 4.3 `test/sources/youtube.lawandcrime/transform.test.ts` (fixtures): cited
      link for a resolvable officer; no link for absent/ambiguous matches; a
      skipped video links on a later run once the officer exists; foreign-channel
      video fails loudly; determinism and no duplicate keys on re-run.
- [x] 4.4 Move the cache test to `test/sources/lib/youtube-video-cache.test.ts`;
      `test/sources/youtube.policeactivity` stays green unchanged.
- [x] 4.5 Validation, measured against the same commands at the branch point
      (`origin/main` @ `fe3f27c`): typecheck, build, and
      `openspec:validate` (41/41) pass; vitest is 1353 passed / 1 failed and
      `format:check` reports one file — both failures pre-exist at the branch
      point in files this change does not touch: - `openspec/specs/mn-post-discipline-coverage/spec.md` fails
      `format:check` on `origin/main` (last touched by `c7893cb`, mn-post). - `test/sources/mn-post/acquire/discipline-workbooks.test.ts` reads
      `sources/mn-post/*.xlsx`; only 3 of the 5 workbooks it needs are tracked
      in git, so it passes only in a checkout that happens to hold the two
      untracked ones. Reported to the board rather than fixed here.

## 5. Not in this change

- Live acquire against the real channel needs `YOUTUBE_API_KEY`, which is not
  present in this environment; the phase is proven with injected fakes.
- `coverage_links` columns for channel id and retrieval time (those stay in the
  evidence envelope).
- Removing the robots-disallowed caption fetch from `youtube.policeactivity` —
  reported to the board as its own item.
