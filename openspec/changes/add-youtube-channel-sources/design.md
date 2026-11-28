# Design

## One shared source, one folder per channel

The shared code lives in `sources/lib/youtube-channel/`, moved from
`sources/com/youtube/policeactivity/` (`acquire.ts`, `transform.ts`,
`video-cache.ts`, `video-envelope.ts`, `channel.ts`). It exports one function
that takes a channel config and returns the `IntakeSource`:

```ts
// sources/com/youtube/lawandcrime/intake.source.ts
export const source = youtubeChannelSource({
  channelId: "UCz8K1occVvDTYDfFo7N5EZw",
  handle: "@LawAndCrime",
  sourceName: "Law&Crime Network",
});
```

Why a folder per channel rather than one source reading N configs: source
namespaces are derived from the folder that holds `intake.source.ts`
(`path-derived-source-namespaces`). A namespace per channel keeps each
channel's state, video cache, canonical-ID ledger entries, `source_name`, and
CLI selection (`intake acquire com/youtube/lawandcrime`) separate, the same way
the state POST request sources are thin `intake.source.ts` configs over the
shared request code. One source holding six channels would mix six publishers'
videos under one namespace.

The config is TypeScript data in `intake.source.ts`, validated by a schema in
the shared code when the source loads, as other sources declare their `request`
data. It is not a YAML envelope, so no new envelope kind or canonical IO is
needed.

The shared code has no branch on channel, handle, or source ID. Everything
else — five-year window, per-agency search, slice choice, retries, quota stop,
evidence envelope, officer-mention rule, accounting — is the current
PoliceActivity behavior, applied to every channel.

## Config

| Field        | Meaning                                                             |
| ------------ | ------------------------------------------------------------------- |
| `channelId`  | The channel's YouTube channel id. Searched by id.                   |
| `handle`     | The channel's handle. Checked against `channelId` each run.         |
| `sourceName` | Written as `CoverageLinks.source_name` and into each evidence file. |

`channelUrl` is derived as `https://www.youtube.com/<handle>`. The window stays
fixed at five years in the shared code; no channel asked for a different one.

Channel ids, from the channel branches (each read from the channel's own page,
`rel=canonical`/`externalId`, outside the robots-disallowed `/api/` prefix):

| Namespace                    | Handle            | Channel id                 | Source name       |
| ---------------------------- | ----------------- | -------------------------- | ----------------- |
| `com/youtube/policeactivity` | `@PoliceActivity` | `UCXMYxKMh3prxnM_4kYZuB3g` | PoliceActivity    |
| `com/youtube/donutoperator`  | `@DonutOperator`  | `UCwkm_Wcyh0pc7UUmZZfL-6w` | Donut Operator    |
| `com/youtube/codebluecam`    | `@CodeBlueCam`    | `UCCKkuXux09y-TCg-BQxCjNA` | Code Blue Cam     |
| `com/youtube/lawandcrime`    | `@LawAndCrime`    | `UCz8K1occVvDTYDfFo7N5EZw` | Law&Crime Network |
| `com/youtube/audittheaudit`  | `@AuditTheAudit`  | `UCc-0YpRpqgA5lPTpSQ5uo-Q` | Audit the Audit   |
| `com/youtube/legaleagle`     | `@LegalEagle`     | `UCpa-Zb0ZcQjTCPP1Dx_1M8Q` | LegalEagle        |

The PoliceActivity id is the `channelId` on every video in the workspace's
current `video-cache.json`; the implementation confirms it from the channel
page before pinning.

## Channel identity: pinned id

Today PoliceActivity resolves its handle on the first run and persists the id
in `<state>/channel.json`. A fresh workspace has no such file, so its first run
trusts whatever the handle resolves to that day. Five of the six channel
branches pinned the id instead. Pinning is the stricter rule and puts the id in
review: acquire resolves the handle each run and fails, naming both ids, when it
does not resolve to the pinned id; every search uses the pinned id; acquire
fails on a search hit whose `channelId` is not the pinned id, and transform
fails on such a video in an evidence file. `channel.json` is no longer written
or read.

## Kept out, from the channel branches

Each of these breaks an AGENTS.md rule or adds a setting nobody asked for, and
the shared source does not do it:

- Removing cached years once they leave the window (`lawandcrime`,
  `audittheaudit` `pruneToWindow`, `lib/youtube-video-cache.ts`
  `pruneYearsBefore`). Raw inputs are preserved; the window is applied when
  reading, as PoliceActivity does.
- Turning any cache read error into an empty cache (`lib/youtube-video-cache.ts`,
  `lib/youtube-channel-cache.ts`, `audittheaudit/video-cache.ts`). Only a
  missing file is an empty cache; any other error fails.
- Environment settings: `YOUTUBE_WINDOW_NOW` (`donutoperator`),
  `YOUTUBE_REFRESH_DAYS` (`codebluecam`), `YOUTUBE_MIN_YEAR`.
- Writing channel id and retrieval time into `coverage_links.notes` as a
  "Source provenance" line (`codebluecam`). Notes hold the video description;
  the evidence file holds the provenance.
- Per-channel copies of the window, cache, retry and mention code.

## Quota

All channels use one `YOUTUBE_API_KEY`. Each channel source already stops its
run on a quota-exhausted response and resumes on its next run, so a quota hit
in one channel leaves the others' caches intact. No cross-channel scheduling is
added.
