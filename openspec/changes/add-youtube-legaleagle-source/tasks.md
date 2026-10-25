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
- [x] Add `sources/youtube.legaleagle/acquire.ts` and `transform.ts` as
      configuration only (`@LegalEagle`, `LegalEagle`, 5 years).
- [x] Cover the window gate, the match gate, the skip-then-link path, and
      idempotence with focused tests.
- [ ] Resolve `@LegalEagle` against the live API and confirm it is the same
      channel as `youtube.com/c/LegalEagle` — blocked on `YOUTUBE_API_KEY`
      (INS-53).
- [ ] Migrate `sources/youtube.policeactivity/` onto the shared implementation
      and fix its window-at-emit gap — INS-48.
