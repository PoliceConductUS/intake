# policeactivity

## Overview

The intake source for namespace `com/youtube/policeactivity`: videos on the PoliceActivity YouTube channel, found by searching the channel once per agency and year, and linked to each officer at that agency the video names. `acquire` saves the search results per agency and never fetches captions; `transform` finds officer mentions in the title and description, resolves each name against the agency's personnel, and emits `CoverageLinks` and `CoverageLinkAgencyPersonnel` artifacts. A video that names no officer the database knows is counted and produces nothing.

## Interface

- `intake.source.ts:source` - the `IntakeSource`: `description`, `produces` (`CoverageLinks`, `CoverageLinkAgencyPersonnel`), `acquire`, `transform`.
- `acquire.ts:acquire` - `SourceAcquire`; `({ sourceDir, state, env, data, logger }) => Promise<void>`. Writes one `<agency ID>.videos.json` per agency that has a cached year, with the agency ID encoded by `encodeURIComponent`.
- `transform.ts:transform` - `SourceTransform`; `({ paths, data, logger }) => Promise<{ artifacts, accounting }>`. Reads `*.videos.json` files named in `paths`, or found in the directories in `paths`.
- `video-cache.ts:CACHE_FILE` - `"video-cache.json"`.
- `video-cache.ts:loadVideoCache` - `(stateDir) => Promise<VideoCache>`; a missing file yields an empty cache.
- `video-cache.ts:saveVideoCache` - `(stateDir, cache) => Promise<void>`.
- `video-cache.ts:nextYearToAcquire` - `(entry, floorYear, currentYear) => number | null`; the year to search next, or null.
- `video-cache.ts:mergedVideos` - `(entry) => AcquiredVideo[]`; every cached year's videos, one per `videoId`.
- Types: `video-cache.ts:AcquiredVideo`, `video-cache.ts:AgencyVideoCacheEntry`, `video-cache.ts:VideoCache`.

## Invariants

- `acquire.ts:acquire` - throws when `YOUTUBE_API_KEY` is missing or blank, and when the channel id for `@PoliceActivity` cannot be resolved.
- `acquire.ts:acquire` - the floor year is the current year when `YOUTUBE_MIN_YEAR` is not set. A `YOUTUBE_MIN_YEAR` that is blank or not a whole number throws `YOUTUBE_MIN_YEAR is not a year: <value>` before any request is sent.
- `acquire.ts:acquire` - an agency with a blank name throws `agency <agency ID> has a blank name` before any agency is searched.
- `acquire.ts:acquire` - the cache key is the agency's source ID (`agencyId` of `AcquireAgencyRecord`) and the output file is `<encodeURIComponent(agencyId)>.videos.json`, so two agencies with one name have separate cache entries and files. The search query is the agency name plus its place, with no state.
- `acquire.ts:acquire` - each run searches at most one year per agency, the year `video-cache.ts:nextYearToAcquire` returns.
- `video-cache.ts:nextYearToAcquire` - returns the newest year from the current year down to the floor year that the cache does not hold. When the cache holds every year, it returns the year searched longest ago among the years last searched before the year ended; the current year is always one of them. A year searched after it ended is never returned. It returns null when no year qualifies; in `acquire` that happens only when the floor year is after the current year.
- `acquire.ts:acquire` - a search of a cached year replaces that year's cached videos and its `searchedAt`.
- `acquire.ts:acquire` - agencies are searched in this order: an agency with a year never searched first, then the agencies whose next year was searched longest ago. Agencies with the same value keep the order of `data.agencies`.
- `acquire.ts:acquire` - a quota-exhausted response (`YoutubeQuotaError`) during an agency's search is logged and stops every later search in the run; the agencies after it are counted as not searched, and `acquire` returns normally. During the channel id lookup it is not caught and `acquire` throws.
- `acquire.ts:acquire` - any other failure in one agency's search is logged, counted, and left uncached so a later run retries it.
- `acquire.ts:acquire` - an agency whose search failed or was not run still gets its `.videos.json` file with the videos of its cached years. When the search failed, the file holds `searchFailure: { year, error }`. An agency with no cached year gets no file.
- `acquire.ts:acquire` - never fetches captions: the caption track is served from `https://www.youtube.com/api/timedtext`, a path that host's robots.txt disallows (`Disallow: /api/`). A video a search returns is cached and written with only the `youtube.ts:YoutubeSearchHit` fields.
- `acquire.ts:acquire` - a response with status 429 or 5xx is retried up to 5 times (`acquire.ts:MAX_RETRIES`, not exported) with a wait capped at 60 seconds (`acquire.ts:MAX_BACKOFF_MS`, not exported); any other failed status throws, and so does an OK response whose body is not a JSON object.
- `video-cache.ts:loadVideoCache` - only a missing file yields an empty cache. Any other read error, a file that is not JSON, and a file with no `agencies` object throw.
- `transform.ts:transform` - throws when `data` is undefined.
- `transform.ts:transform` - throws, naming the file, on a file with no agency ID or name and on a file with no `videos` list.
- `transform.ts:transform` - throws, naming the file and the video, on a video with no `videoId`, `url` or `title`, and on a video whose `publishedAt` does not start with a `YYYY-MM-DD` date.
- `transform.ts:transform` - the directories in `paths` are scanned (`transform.ts:collectEnvelopePaths`, not exported) only when no path in `paths` ends with `.videos.json`; a path that cannot be read as a directory throws.
- `transform.ts:transform` - a video is emitted only when `data.resolvePersonnel` returns a match for at least one mention. Any other video is counted as not selected under `names no officer the database knows`.
- `transform.ts:transform` - `accounting` has one entry, `videos`: every video of every file is read once and is either emitted or not selected. `reported` is always 0.
- `transform.ts:transform` - a video that two agency files hold yields one `CoverageLinks` record. When the two would yield different `CoverageLinks` values the transform throws, naming the video and both files.
- `transform.ts:transform` - the `CoverageLinks` record's `published_at` is a `YYYY-MM-DD` date and its `notes` is the video description, or null when it is blank. Each `CoverageLinkAgencyPersonnel` record has `confidence: "named-in-video"` and, as `notes`, the first passage that named the officer.
- `transform.ts:OFFICER_MENTION` (not exported) - a mention is a role word followed by a two- or three-word capitalized name that passes `isPersonName` (`transform.ts:officerMentions`, not exported). Mentions come from the video's `title` and `description` only; a `captions` field in a video file is not read.

## Side Effects

- `acquire.ts:acquire` - calls the YouTube Data API through `createYoutubeApi` (channel id, channel video search) with the key from `env.YOUTUBE_API_KEY`, and sends no other request; reads `env.YOUTUBE_MIN_YEAR`; pauses 250 ms after each agency search that succeeds.
- `acquire.ts:acquire` - appends every YouTube Data API response (time, URL without the key, status, body) to `<sourceDir>/.api-calls.jsonl`; writes `<sourceDir>/channel.json` and `<sourceDir>/<encodeURIComponent(agencyId)>.videos.json`.
- `acquire.ts:acquire` - pages through all agencies with `data.agencies({ minOfficers: 1, limit: 50 })` before the first search.
- `acquire.ts:acquire` - logs each search, each failed search, and a last line with the counts: agency-years searched, agencies with no year to search, failed, and not searched after the quota stop.
- `video-cache.ts:loadVideoCache` / `video-cache.ts:saveVideoCache` - read and write `<state>/video-cache.json`; the cache is saved after each agency-year search.
- `transform.ts:transform` - reads the `*.videos.json` files; calls `data.resolvePersonnel` for each mention; logs the counts. No writes.

## Verification

- Run: `npx vitest run test/sources/youtube.policeactivity`
