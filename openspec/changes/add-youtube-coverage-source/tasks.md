> **Updated 2026-08-24.** Source, spec, and tests are landed and green. The one
> remaining item (1.5) is a real `intake acquire` against the YouTube Data API,
> which needs a `YOUTUBE_API_KEY` that is not yet provisioned.

## 1. Source module

- [x] 1.0 `sources/com.youtube.donutoperator/channel.ts`: pin channel ID
      `UCwkm_Wcyh0pc7UUmZZfL-6w`, handle `@DonutOperator`, canonical URL, display
      name, and the board's rank-1 subscriber snapshot (5,310,000 on 2026-08-24).
      `watchUrl()` builds the canonical watch URL from a video ID.
- [x] 1.1 `acquire.ts`: YouTube Data API v3. Require `YOUTUBE_API_KEY`; resolve
      by `channels.list?id=<pinned>` and fail unless exactly that channel comes
      back; write the raw response to `channel.json`; page
      `playlistItems.list?part=snippet,contentDetails,status` over the uploads
      playlist into `uploads-NNNN.json`; write `provenance.json`. Retry 429/5xx
      with capped backoff; never retry 403.
- [x] 1.2 `run.ts`: `produces: ["CoverageLinks"]`. Re-verify `channel.json` is
      the pinned channel and every item's `snippet.channelId` matches; emit one
      `CoverageLink` per public upload keyed by video ID (`url` =
      `normalized_url` = canonical watch URL, `published_at` =
      `contentDetails.videoPublishedAt`, `source_name` = pinned display name);
      skip non-public and incomplete entries with a logged count. Deterministic:
      no network, clock, or randomness.
- [x] 1.3 Confirm no pipeline change is needed: `CoverageLinks` is registered
      with `dependsOn: []`, has source facades in
      `import/artifacts/config.ts`, entity handling in `data-context.ts`, and a
      ledger entity block — mn-post already emits the kind.
- [x] 1.4 Confirm the source registers: `intake sources` lists
      `com.youtube.donutoperator [acquire, run]`, `produces: CoverageLinks`, and
      no consumed kinds.
- [ ] 1.5 Run a real `intake acquire com.youtube.donutoperator`, confirm the
      pinned channel resolves and the observed subscriber count is in the range
      of the board snapshot, and record the page/item counts.
      _PENDING — requires a `YOUTUBE_API_KEY`._

## 2. Tests

- [x] 2.0 `test/sources/com.youtube.donutoperator/run.test.ts`: record shape and
      key, determinism, private/deleted/incomplete skipping, wrong-channel
      `channel.json` rejected, foreign-channel upload rejected, empty snapshot
      rejected, `produces` is coverage-only, subscriber snapshot pinned.
- [x] 2.1 Acceptance: build the manifest into an `Artifacts` envelope and read it
      back through `Artifacts.read({ includeKinds: ["CoverageLinks"] })` — the
      same call root intake makes, which validates every record against
      `CoverageLinkSpec`.

## 3. Validation

- [x] 3.0 `npm run test:vitest`
- [x] 3.1 `npm run typecheck`
- [x] 3.2 `npm run format:check`
- [x] 3.3 `npm run build`
- [x] 3.4 `npm run openspec:validate`
