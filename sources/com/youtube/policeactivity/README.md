# policeactivity

## Overview

The intake source for namespace `com/youtube/policeactivity`: videos on the PoliceActivity YouTube channel, found by searching the channel once per agency and year inside a rolling five-year window, and linked to each officer at that agency the video names. `acquire` saves the search results per agency and never fetches captions; `transform` finds officer mentions in the title and description, resolves each name against the agency's personnel, and emits `CoverageLinks` and `CoverageLinkAgencyPersonnel` artifacts. A video that names no officer the database knows is counted and produces nothing.

## Interface

- `intake.source.ts:source` - the `IntakeSource`: `description`, `produces` (`CoverageLinks`, `CoverageLinkAgencyPersonnel`), `acquire`, `transform`.
- `acquire.ts:acquire` - `SourceAcquire`; `({ sourceDir, state, env, data, logger }) => Promise<void>`. Writes one `<agency ID>.videos.json` per agency that has a cached year, with the agency ID encoded by `encodeURIComponent`.
- `transform.ts:transform` - `SourceTransform`; `({ paths, data, logger }) => Promise<{ artifacts, accounting }>`. Reads `*.videos.json` files named in `paths`, or found in the directories in `paths`.
- `video-cache.ts:CACHE_FILE` - `"video-cache.json"`.
- `video-cache.ts:loadVideoCache` - `(stateDir) => Promise<VideoCache>`; a missing file yields an empty cache.
- `video-cache.ts:saveVideoCache` - `(stateDir, cache) => Promise<void>`.
- `video-cache.ts:windowYears` - `(window) => number[]`; every calendar year the window touches, newest first.
- `video-cache.ts:nextSliceToSearch` - `(entry, window) => VideoSlice`; the year to search next, with its bounds clipped to the window.
- `video-cache.ts:recordSlice` - `(entry, slice, searchedAt, videos) => AgencyVideoCacheEntry`; the entry with the slice's videos merged in.
- `video-cache.ts:inWindowVideos` - `(entry, window) => AcquiredVideo[]`; the cached videos inside the window, one per `videoId`, newest published first.
- `channel.ts` - `SOURCE_ID`, `CHANNEL_HANDLE`, `CHANNEL_URL`, `SOURCE_NAME`, `WINDOW_YEARS` (5), and `stableChannelId(stateDir, resolveChannelId) => Promise<string>`.
- `video-envelope.ts` - `VideoEnvelopeSchema`, `ENVELOPE_SUFFIX` (`".videos.json"`), `writeVideoEnvelope(filePath, envelope)`, `readVideoEnvelope(filePath)`.
- Types: `video-cache.ts:AcquiredVideo`, `video-cache.ts:AgencyVideoCacheEntry`, `video-cache.ts:VideoCache`, `video-cache.ts:VideoSlice`, `video-envelope.ts:VideoEnvelope`.

## Invariants

- `acquire.ts:acquire` - throws when `YOUTUBE_API_KEY` is missing or blank.
- `channel.ts:stableChannelId` - throws when `@PoliceActivity` resolves to no channel id, and when it resolves to a channel id other than the one persisted in `<state>/channel.json`. The first run persists the id.
- `acquire.ts:acquire` - the window is `[run time - 5 years, run time]` (`lib/rolling-window.ts:rollingWindow`), computed once per run. No setting changes it.
- `acquire.ts:acquire` - an agency with a blank name throws `agency <agency ID> has a blank name` before any agency is searched.
- `acquire.ts:acquire` - the cache key is the agency's source ID (`agencyId` of `AcquireAgencyRecord`) and the output file is `<encodeURIComponent(agencyId)>.videos.json`, so two agencies with one name have separate cache entries and files. The search query is the agency name plus its place, with no state.
- `acquire.ts:acquire` - each run searches at most one year per agency, the slice `video-cache.ts:nextSliceToSearch` returns.
- `video-cache.ts:nextSliceToSearch` - returns the newest year the window touches that the cache does not hold. When the cache holds every year, it returns the year searched longest ago among the years last searched before the year ended; the window's end year is always one of them. A year searched after it ended is never returned. It throws when no year qualifies, which only a cache written under a later clock can cause. The bounds are the calendar year clipped to the window.
- `video-cache.ts:recordSlice` - a search of a cached year replaces its `searchedAt`; each returned video replaces the cached video with the same `videoId`, and a cached video the search no longer returns is kept. Each video carries the `retrievedAt` of the search that returned it.
- `acquire.ts:acquire` - agencies are searched in this order: an agency with a year never searched first, then the agencies whose next year was searched longest ago. Agencies with the same value keep the order of `data.agencies`.
- `acquire.ts:acquire` - a quota-exhausted response (`YoutubeQuotaError`) during an agency's search is logged and stops every later search in the run; the agencies after it are counted as not searched, and `acquire` returns normally. During the channel id lookup it is not caught and `acquire` throws.
- `acquire.ts:acquire` - any other failure in one agency's search is logged, counted, and left uncached so a later run retries it.
- `acquire.ts:acquire` - an agency whose search failed or was not run still gets its `.videos.json` file with the videos of its cached years inside the window. When the search failed, the file holds `searchFailure: { year, error }`. An agency with no cached year gets no file.
- `video-envelope.ts` - each `.videos.json` file holds `source` (name, handle, channel URL, channel id), the run's `window`, the `agency`, the `videos`, and an optional `searchFailure`. It is validated with `VideoEnvelopeSchema` on write and on read; an unknown key, a missing window, or a video with no `publishedAt` or `retrievedAt` timestamp throws, naming the file.
- `acquire.ts:acquire` - never fetches captions: the caption track is served from `https://www.youtube.com/api/timedtext`, a path that host's robots.txt disallows (`Disallow: /api/`). A video a search returns is cached and written with only the `youtube.ts:YoutubeSearchHit` fields.
- `acquire.ts:acquire` - a response with status 429 or 5xx is retried up to 5 times (`acquire.ts:MAX_RETRIES`, not exported) with a wait capped at 60 seconds (`acquire.ts:MAX_BACKOFF_MS`, not exported); any other failed status throws, and so does an OK response whose body is not a JSON object.
- `video-cache.ts:loadVideoCache` - only a missing file yields an empty cache. Any other read error, a file that is not JSON, and a file with no `agencies` object throw.
- `transform.ts:transform` - throws when `data` is undefined.
- `transform.ts:transform` - throws, naming the file, on a file `video-envelope.ts:readVideoEnvelope` rejects.
- `transform.ts:transform` - throws, naming the file and the video, on a video with no `videoId`, `url` or `title`, and on a video whose `publishedAt` does not start with a `YYYY-MM-DD` date.
- `transform.ts:transform` - a video published outside the file's `window` is counted as not selected under `published outside the acquired five-year window` and is not resolved. The transform reads no clock.
- `transform.ts:transform` - the directories in `paths` are scanned (`transform.ts:collectEnvelopePaths`, not exported) only when no path in `paths` ends with `.videos.json`; a path that cannot be read as a directory throws.
- `transform.ts:transform` - a video is emitted only when `data.resolvePersonnel` returns a match for at least one mention. Any other video is counted as not selected under `names no officer the database knows`.
- `transform.ts:transform` - `accounting` has one entry, `videos`: every video of every file is read once and is either emitted or not selected. `reported` is always 0.
- `transform.ts:transform` - a video that two agency files hold yields one `CoverageLinks` record. When the two would yield different `CoverageLinks` values the transform throws, naming the video and both files.
- `transform.ts:transform` - the `CoverageLinks` record's `source_name` is the file's `source.name`, its `published_at` is a `YYYY-MM-DD` date and its `notes` is the video description, or null when it is blank. Each `CoverageLinkAgencyPersonnel` record has `confidence: "named-in-video"` and, as `notes`, the first passage that named the officer.
- `transform.ts:OFFICER_MENTION` (not exported) - a mention is a role word followed by a two- or three-word capitalized name that passes `isPersonName` (`transform.ts:officerMentions`, not exported). Mentions come from the video's `title` and `description` only; a video file with a `captions` field is rejected.

## Side Effects

- `acquire.ts:acquire` - calls the YouTube Data API through `createYoutubeApi` (channel id, channel video search) with the key from `env.YOUTUBE_API_KEY`, and sends no other request; pauses 250 ms after each agency search that succeeds.
- `acquire.ts:acquire` - appends every YouTube Data API response (time, URL without the key, status, body) to `<sourceDir>/.api-calls.jsonl`; writes `<sourceDir>/<encodeURIComponent(agencyId)>.videos.json`; `channel.ts:stableChannelId` writes `<state>/channel.json` on the first run.
- `acquire.ts:acquire` - pages through all agencies with `data.agencies({ minOfficers: 1, limit: 50 })` before the first search.
- `acquire.ts:acquire` - logs each search, each failed search, and a last line with the channel id, the window, and the counts: agency-years backfilled, refreshed, failed, and not searched after the quota stop.
- `video-cache.ts:loadVideoCache` / `video-cache.ts:saveVideoCache` - read and write `<state>/video-cache.json`; the cache is saved after each agency-year search.
- `transform.ts:transform` - reads the `*.videos.json` files; calls `data.resolvePersonnel` for each mention; logs the counts. No writes.

## Verification

- Run: `npx vitest run test/sources/com/youtube/policeactivity`
