## Why

Five branches (INS-46, INS-49, INS-50, INS-51, INS-52) each add one YouTube
channel as its own source: Donut Operator, Code Blue Cam, Law&Crime Network,
Audit the Audit and LegalEagle. They do the same thing as
`com/youtube/policeactivity` — search the channel per agency inside the rolling
five-year window and link a video to an existing officer it names — but each
rebuilt the search, cache, window and mention code its own way. At the top of
the stack that is six overlapping libraries in `sources/lib` plus per-source
copies, all written for the pre-`intake.source.ts` layout, and several break
AGENTS.md rules (see design.md). Porting them one by one would keep six copies
of logic that must not drift between channels.

## What Changes

- The `com/youtube/policeactivity` implementation (acquire, transform, video
  cache, evidence envelope) moves to one shared YouTube channel source in
  `sources/lib/youtube-channel/`, unchanged in behavior except for channel
  identity (below).
- Each channel is a source folder `sources/com/youtube/<channel>/` whose
  `intake.source.ts` passes one channel config — channel id, handle, source
  name — to the shared source. PoliceActivity becomes one of these configs.
- Five channel folders are added: `com/youtube/donutoperator`,
  `com/youtube/codebluecam`, `com/youtube/lawandcrime`,
  `com/youtube/audittheaudit`, `com/youtube/legaleagle`.
- Channel identity: the channel id is pinned in the checked-in config. Acquire
  fails when the handle resolves to another id, and acquire and transform fail
  on a video from another channel. The persisted `<state>/channel.json` is no
  longer written or read.
- The five channel branches and their OpenSpec changes
  (`add-youtube-{donutoperator,codebluecam,lawandcrime,audittheaudit,legaleagle}-source`)
  are replaced by this change and are not merged.

## Capabilities

### Modified Capabilities

- `youtube-video-coverage-import`: the requirements apply to every configured
  channel; the channel identity requirement changes from resolve-and-persist to
  a pinned id; videos from another channel are rejected.

## Impact

- Intake sources: `sources/com/youtube/policeactivity/` (reduced to its config),
  five new `sources/com/youtube/<channel>/` folders, new shared code in
  `sources/lib/youtube-channel/`, `sources/com/youtube/README.md`.
- No migration, schema, envelope kind or generated type change: every channel
  emits the existing `CoverageLinks` and `CoverageLinkAgencyPersonnel` kinds.
  No data reset.
- Every channel shares the one `YOUTUBE_API_KEY` daily quota.
- PoliceActivity's workspace state (`video-cache.json`) keeps its path and
  shape, so no re-acquire is needed.
