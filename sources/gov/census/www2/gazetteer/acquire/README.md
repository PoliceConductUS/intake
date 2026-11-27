# gov/census/www2/gazetteer/acquire

## Overview

The two steps behind the `gov/census/www2/gazetteer` acquire. `discovery.ts` reads Census HTML pages and works out which year to use and which Gazetteer and TIGER files belong to it. `download.ts` brings those files into the source directory, reusing a local zip when it is proven to match the remote one.

## Interface

- `discovery.ts:GazetteerLinks` - the selected `year` and the URL of each source file: the three Gazetteer files, the state and county TIGER files, the place, county-subdivision, and consolidated-city TIGER files, and an optional `hierarchyUrl`.
- `discovery.ts:selectPublishedGazetteerPage` - `(html, pageUrl, tigerIndexHtml, tigerIndexUrl) => { year, pageUrl }`; the newest year that has both a Gazetteer page and a `TIGER<year>/` directory, with the URL of that year's Gazetteer page.
- `discovery.ts:discoverLatestGazetteerLinks` - `(html, pageUrl) => GazetteerLinks`; sorts the page's links by role and builds the TIGER URLs the page does not link (rules under Invariants).
- `discovery.ts:assertPublishedSourceLinks` - `(html, directoryUrl, expectedUrls) => void`; checks that a TIGER directory index links every expected file.
- `download.ts:gazetteerSourceUrls` - `(links: GazetteerLinks) => string[]`; the ordered list of URLs to acquire.
- `download.ts:downloadGazetteerSources` - `({ sourceDir, previousSourceDirs, urls, fetchBytes, fetchRange, logger }) => Promise<void>`.
- `download.ts:DownloadLogger`, `download.ts:FetchBytes`, `download.ts:RemoteTail` - the types of the injected logger, the full-download callback, and the range-request result.

## Invariants

- `discovery.ts:selectPublishedGazetteerPage`:
  - It calls `discovery.ts:discoverLatestGazetteerLinks` on the current page first, so it also throws that function's errors.
  - Its candidate pages are the current page, for the year that call returns, and each link on it that matches `gazetteer-files.<year>.html` with a year older than that one.
  - It throws `census: no shared published Gazetteer/TIGER shapefile year` when no candidate year has a `TIGER<year>/` link in the TIGER index.
- `discovery.ts:findLatestSourceYear` (not exported) sets the year for `discovery.ts:discoverLatestGazetteerLinks`: the newest year whose links include the states, administrative-areas, and places Gazetteer files, else the newest year that any link mentions.
- `discovery.ts:discoverLatestGazetteerLinks`:
  - It throws `No Census Gazetteer source year links were discovered` when no link mentions a year.
  - It throws `Missing required <year> Gazetteer source links` when the states, administrative-areas, or places file is absent. This happens only when no year has all three, so the year is the newest one mentioned.
  - The state and county TIGER URLs default to `TIGER<year>/STATE/tl_<year>_us_state.zip` and `TIGER<year>/COUNTY/tl_<year>_us_county.zip`.
  - The place TIGER URLs default to one per entry of `discovery.ts:STATE_GEOIDS` (not exported), the 50 states and DC.
  - The county-subdivision TIGER URLs default to one per state of the place URLs.
  - The consolidated-city TIGER URLs default to one per state of the place URLs that is in `../lib/roles.ts:CONSOLIDATED_CITY_STATES`.
  - A linked place URL whose path does not match `tl_<year>_<ss>_place.zip` throws `census: place TIGER link is not tl_<year>_<state>_place.zip: <url>`.
- `discovery.ts:assertPublishedSourceLinks` throws `census: required TIGER files are not published` and names the missing files.
- `discovery.ts:classifyLinks` (not exported) keeps the first URL for a role that takes one file and every URL for a role that takes many.
- `download.ts:downloadGazetteerSources`, for each URL:
  - The local candidates are the file of the same name in `sourceDir`, then in each `previousSourceDirs` entry, in that order.
  - It calls `fetchRange` only when a candidate exists and the file name ends in `.zip`. A file with another extension, such as the hierarchy file, is always downloaded again.
  - When `fetchRange` returns `full: true`, those bytes are written as the download; no candidate is compared and `fetchBytes` is not called.
  - Otherwise the first candidate that `download.ts:matchesRemoteZip` accepts is reused. When none is accepted, the file is downloaded with `fetchBytes`.
  - A reused file that is already at the destination is left as it is and nothing is written. Every other file is written or copied to `<destination>.partial` and then renamed, so a file in the source directory is always complete.
- `download.ts:matchesRemoteZip` (not exported) accepts a local zip only when the remote tail holds the whole central directory (`download.ts:containsCentralDirectory`, not exported), the local size equals the remote size, the local tail equals the remote tail, and the zip contents verify. A failure in `verifyZipContentsFromFd` is caught and returned as no match.
- `download.ts:fileExists` (not exported) returns false for a missing path and for a path that is not a regular file, and rethrows every error other than `ENOENT`.

## Side Effects

- `discovery.ts` has none. It parses HTML passed to it and builds URLs under `https://www2.census.gov/geo/tiger/`.
- `download.ts:downloadGazetteerSources` creates `sourceDir`, deletes any `.zip` there that is not among the selected URLs, copies a verified zip from a directory in `previousSourceDirs`, and writes downloaded files into `sourceDir`.
- `download.ts:downloadGazetteerSources` makes network requests only through the injected `fetchRange` and `fetchBytes` callbacks.
- `download.ts:matchesRemoteZip` opens and reads the candidate local zip, unless the remote tail lacks the whole central directory; then it returns false without opening the file.
- `download.ts:downloadGazetteerSources` logs one `reused verified` or `downloading` line per file through the injected `logger`.

## Verification

- Run: `npx vitest run test/sources/gov/census/www2/gazetteer/acquire/discovery.test.ts test/sources/gov/census/www2/gazetteer/acquire/download.test.ts`
