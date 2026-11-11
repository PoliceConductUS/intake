# Tasks

> Landed: the shared channel factory, the pinned-channel-id guard, the rolling
> five-year window (recorded in acquire, enforced in transform), skip
> reconsideration, and case-preserving URL canonicalization, with focused tests.
> A live acquire run still needs `YOUTUBE_API_KEY` (INS-53).

## 1. Shared channel implementation

- [x] 1.1 `sources/lib/youtube-channel.ts`: `ChannelSourceConfig`,
      `createChannelAcquire`, `createChannelTransform`, `rollingWindowStart`,
      `inWindow`, `normalizeVideoUrl`, `officerMentions`, `provenanceNote`.
- [x] 1.2 `sources/lib/youtube-video-cache.ts`: per-agency/per-year cache with
      `planYearToAcquire` (refreshes the open current year, backfills older years
      newest-first) and `pruneYearsBefore`.
- [x] 1.3 Reuse the existing `sources/lib/youtube.ts` Data API client unchanged.

## 2. The Code Blue Cam source

- [x] 2.1 `sources/youtube.codebluecam/channel.ts` pins `@CodeBlueCam` →
      `UCCKkuXux09y-TCg-BQxCjNA` with the provenance of that id.
- [x] 2.2 `acquire.ts` and `transform.ts` bind the shared factory; discovery is by
      convention (`sources/<namespace>/transform.ts`), so no registry edit.
- [x] 2.3 Acquire aborts on a handle/pin mismatch and writes `channel.json` plus a
      per-agency envelope stamped with the window, channel and retrieval time.
- [x] 2.4 Transform emits `CoverageLinks` + `CoverageLinkAgencyPersonnel` only for
      in-window videos with a definitive officer match at the acquired agency.

## 3. Tests + validation

- [x] 3.1 `test/sources/lib/youtube-channel.test.ts`: window boundaries,
      unparseable publication times, case-preserving canonicalization, mention
      extraction, year planning, cache pruning and merge stability.
- [x] 3.2 `test/sources/youtube.codebluecam/acquire.test.ts`: pin recorded,
      mismatch refused, search bounded by the window, envelope contents (no video
      media), `YOUTUBE_API_KEY` required.
- [x] 3.3 `test/sources/youtube.codebluecam/transform.test.ts`: in-window match
      links with provenance; before/after-window, unmatched, unnamed and ambiguous
      produce nothing; a skipped video links on a later run once its officer
      exists; re-running unchanged state is deep-equal; mints nothing; refuses a
      foreign-channel or window-less envelope.
- [x] 3.4 `npm run validate` (format:check, typecheck, vitest, build,
      openspec:validate).

## 4. Follow-ups (not this change)

- [ ] 4.1 Migrate `sources/youtube.policeactivity/` onto the shared factory. It
      would change a landed source's behavior (it currently applies no window and
      never refreshes the current year), so it belongs to INS-48.
- [ ] 4.2 First-class provenance columns for coverage links (channel id, retrieval
      time, full publication timestamp). `CoverageLinkSpec` is `.strict()` and
      `published_at` is a `date`, so these ride in `notes` today. One change
      serving all six channels.
- [ ] 4.3 Explicit source-state records for videos that were deleted, made
      private, or changed since a prior acquisition (shared with the rank-1
      source's open task 1.4).
