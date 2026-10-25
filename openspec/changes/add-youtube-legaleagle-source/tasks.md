# Tasks

- [x] Extract the channel coverage behavior into `sources/lib/youtube-channel.ts`
      as `createChannelAcquire` / `createChannelTransform` over a
      `ChannelSourceConfig`.
- [x] Compute the rolling window once per run from the run instant, clip every
      search to it, and stamp `window` + `retrievedAt` into each envelope.
- [x] Enforce the window at emit time in transform, reading it from the
      envelope rather than the clock.
- [x] Order agencies stalest-first; search the newest unsearched window year,
      then refresh the newest year once the backfill is complete.
- [x] Add `sources/youtube.legaleagle/` as configuration only (pinned id
      `UCpa-Zb0ZcQjTCPP1Dx_1M8Q`, `@LegalEagle`, `LegalEagle`, 5 years).
- [x] Pin and verify the channel id rather than resolving a handle; re-check
      each video's channel at emit.
- [x] Drop the caption fetch: `youtube.com/robots.txt` disallows `/api/`, which
      covers `api/timedtext`. Title and description only.
- [x] Cover the window gate, the match gate, the skip-then-link path, and
      idempotence with focused tests.
- [x] Confirm `/c/LegalEagle` and `@LegalEagle` are the same channel — both
      canonicalize to `channel/UCpa-Zb0ZcQjTCPP1Dx_1M8Q`.
- [ ] Re-verify the pinned id against the keyed Data API on the first real run
      — needs `YOUTUBE_API_KEY` (INS-53).
- [ ] Migrate `sources/youtube.policeactivity/` onto the shared implementation
      and fix its window-at-emit gap — INS-48.
