# Tasks

## 1. Shared source

- [ ] 1.1 Move `acquire.ts`, `transform.ts`, `video-cache.ts`,
      `video-envelope.ts` and `channel.ts` from
      `sources/com/youtube/policeactivity/` to `sources/lib/youtube-channel/`,
      and export `youtubeChannelSource(config)` returning the `IntakeSource`.
- [ ] 1.2 Validate the config (`channelId`, `handle`, `sourceName`) with a
      strict schema when the source loads; derive the channel URL from the
      handle.
- [ ] 1.3 Replace resolve-and-persist with the pinned id: search by
      `config.channelId`; fail when the handle resolves elsewhere or to nothing;
      fail on a search hit or evidence video with another `channelId`. Remove
      the `channel.json` writer and reader.
- [ ] 1.4 Move the tests to `test/sources/lib/youtube-channel/` and run them
      against a test config; add tests for the pinned-id, other-channel and
      malformed-config scenarios.

## 2. Channel configs

- [ ] 2.1 `sources/com/youtube/policeactivity/intake.source.ts` passes its config;
      confirm `UCXMYxKMh3prxnM_4kYZuB3g` from the channel page before pinning.
- [ ] 2.2 Add `sources/com/youtube/{donutoperator,codebluecam,lawandcrime,audittheaudit,legaleagle}/intake.source.ts`
      with the ids and names in design.md.
- [ ] 2.3 One README per channel folder and an updated
      `sources/com/youtube/README.md`; `sources/lib/README.md` lists
      `youtube-channel`.
- [ ] 2.4 A test that each channel's config loads through source discovery and
      that its namespace is its folder path.

## 3. Replaced branches

- [ ] 3.1 After this change merges, close PRs #77, #74, #75, #73 and #78 and
      delete their branches; their OpenSpec changes are not merged.

## 4. Validation

- [ ] 4.1 `npx openspec validate add-youtube-channel-sources --strict`.
- [ ] 4.2 `npm run validate`.
- [ ] 4.3 Run `intake transform com/youtube/policeactivity` against the
      workspace's existing evidence and confirm the emitted records equal those
      before the move.
- [ ] 4.4 Archive `add-youtube-policeactivity-source` before this change: this
      change modifies the `youtube-video-coverage-import` spec that change adds.
