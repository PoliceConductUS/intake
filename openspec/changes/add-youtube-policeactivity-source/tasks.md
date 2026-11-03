# Tasks

> Landed in #59: the officer-link path (per-agency channel search → officers
> resolved at the acquired agency → CoverageLink + CoverageLinkAgencyPersonnel).
> This pass (INS-48) adds the board's required behavior: one stable channel
> identity, the rolling five-year window applied end to end, per-video retrieval
> time, and acquisition limited to the Data API. Live acquire needs
> `YOUTUBE_API_KEY`.

## 1. Source configuration + acquire (per-agency channel search)

- [x] 1.1 `sources/youtube.policeactivity/transform.ts` exports `transform`,
      `produces` (CoverageLinks, CoverageLinkAgencyPersonnel), `description`.
- [x] 1.2 Shared client `sources/lib/youtube.ts`: resolve `@PoliceActivity` →
      channel id; `search?channelId=…&q=…&type=video`. `YOUTUBE_API_KEY` from
      env; documented in `.env.example`.
- [x] 1.3 `acquire.ts`: page agencies via `data.agencies({ minOfficers })`; per
      agency search the channel by name/place; store each hit **stamped with the
      agency source id** as raw evidence; per-agency cache.
- [x] 1.4 `channel.ts` declares the channel (handle, URL, `source_name`) and the
      5-year window length. No env knob: `YOUTUBE_MIN_YEAR` is removed.
- [x] 1.5 Stable channel identity: resolve the handle, persist the id in the
      source state dir, and fail loudly when a later run resolves a different id.
- [x] 1.6 Rolling window: `sources/lib/rolling-window.ts` computes
      `[runAt - 5y, runAt]`; every search slice is clipped to it and the window is
      stamped on each evidence envelope.
- [x] 1.7 Slice selection: newest never-searched covered year (backfill), then
      the window's end year on every later run so new uploads are picked up.
- [x] 1.8 Per-video `retrievedAt`; the newest observation of a video replaces the
      cached one so a changed title/description reaches the link as an update.
- [ ] 1.9 Explicit source-state records for deleted/private videos. Not built:
      the Data API search omits them, and detecting a disappearance against the
      cache is separate work. The cache keeps the last observation.

## 2. Produce: resolve officers at the known agency + emit cited links

- [x] 2.1 Officer-name candidate extraction from title + description
      (`(?i:role)` prefix + Title-case name; gated by `isPersonName`). Captions
      are **not** a source: `youtube.com/robots.txt` disallows `/api/`, which the
      `/api/timedtext` track lives under.
- [x] 2.2 Per video at its acquired agency, resolve each named officer via
      `resolvePersonnel`; emit CoverageLink (keyed by the stable `videoId`) +
      CoverageLinkAgencyPersonnel for resolved officers, each with the naming
      passage in `notes`.
- [x] 2.3 A video with no verified link emits no durable coverage record;
      `transform()` is deterministic (no network/clock/randomness) and applies the
      window stamped on its input.
- [x] 2.4 Envelope validation is fail-loud: a missing window stamp, publication
      time, or retrieval time is an error, not a skipped record.
- [ ] 2.5 Case links (`CoverageLinkCivilCase`) — out of scope for this source.
      Neither the artifact kind nor a match-only `resolveCivilCase` capability
      exists in `main`; a video is linked to officers only.

## 3. Tests + validation

- [x] 3.1 Acquire-orchestration tests (fakes): per-agency loop, agency-stamped
      envelopes, window-clipped slices, channel-id persistence/assertion,
      cache/idempotency.
- [x] 3.2 Produce tests (fixtures): supported officer link emitted with citation;
      unresolvable/unnamed/out-of-window video → no link; a skipped video linked
      on a later run once the officer exists; determinism.
- [x] 3.3 `npm run openspec:validate` and the narrow source tests pass.
