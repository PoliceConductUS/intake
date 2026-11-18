# gov/census/www2/gazetteer

## Overview

Source namespace `gov/census/www2/gazetteer`: the US Census Gazetteer and TIGER source. It produces the canonical location-path tree (state, administrative area, place, including local jurisdictions) with geometry. Its description states that it runs first so other sources resolve against it (ADR 0015). The acquire finds the newest year published for both Gazetteer and TIGER and downloads the files; the transform parses them and emits `LocationPaths`, `LocationPathAliases`, and `LocationPathGeometries`.

## Interface

- `intake.source.ts:source` - the `IntakeSource` for this namespace: a `description`, `acquire`, `transform`, and `produces` listing `LocationPaths`, `LocationPathAliases`, and `LocationPathGeometries`.
- `acquire.ts:acquire` - a `SourceAcquire` taking `{ sourceDir, previousSourceDirs, env, logger }`. It selects the shared year, discovers the links, checks that the TIGER files are published, and downloads every source file into `sourceDir`.
- `transform.ts:transform` - a `SourceTransform`. It matches the input paths, parses the Gazetteer zips, builds the hierarchy, the location paths, the supplemental places, and the geometry. It returns the `LocationPaths` artifact, the `LocationPathAliases` artifact when there are aliases, and its row accounting, and passes each `LocationPathGeometries` record to `deps.emit`.
- [acquire](./acquire/README.md) - year and link discovery, and the download with reuse of verified local zips.
- [lib](./lib/README.md) - input matching, parsing, TIGER hierarchy, location paths, supplemental places, and geometry.

## Invariants

- `acquire.ts:acquire` runs in this order: select the shared year, discover the links, check each TIGER directory index with `assertPublishedSourceLinks`, then download.
- `acquire.ts:acquire` throws `census: expected Gazetteer <year>, received <year>` when the discovered links are for a different year than the selected one.
- `acquire.ts:fetchOk` throws `census: failed to fetch <url>: <status>` on a response that is not ok.
- `acquire.ts:readBytes` throws `census: incomplete download from <url>` when the response has a `content-length` header and the byte count differs from it. A response without that header is accepted. A downloaded zip is not opened by the acquire; a zip cut short has no end-of-central-directory record, so the transform fails when it opens it.
- The `fetchRange` callback built in `acquire.ts:acquire` requests the last 65,557 bytes of the file with the header `Range: bytes=-65557`. It takes a 200 response as the full body, and otherwise throws `census: invalid range response from <url>` unless the response is a 206 whose `content-range` ends at the file's last byte and matches the bytes received.
- `transform.ts:readGazetteerZip` reads the first zip entry whose name ends in `.txt`, in any letter case, and throws `No .txt entry found in Gazetteer zip` when there is none.
- `transform.ts:transform` takes the hierarchy from the hierarchy file when one was acquired and from `buildHierarchyFromTiger` otherwise.
- `transform.ts:transform` writes no finding: no licensing authority stands for a location path. Every row and feature it reads is emitted, counted under a named reason, or stops the transform with an error.
- `transform.ts:transform` states its row accounting with one entry for each input, named by the file name, or by `tl_<year>_<state>_<kind>.zip` for an input of one file per state:
  - the Gazetteer states, administrative-areas and places files: a row is emitted as a location path, or counted under `outside 50 states plus District of Columbia`;
  - the hierarchy file, only when one was acquired: a row is emitted when its place is a location path, or counted under the same reason when its state is outside the allowed states;
  - the state, county and place TIGER files: a feature is emitted when it supplies the geometry of a location path, or counted under the same reason;
  - the county-subdivision TIGER files: a feature is emitted when the report has it as `included`, and counted under `fully covered by Census places` (`covered`), `statistical or undefined county subdivision` (`excluded`), or `outside 50 states plus District of Columbia`;
  - the consolidated-city TIGER files: a feature is emitted, or counted under `outside 50 states plus District of Columbia`.
- `transform.ts:transform` passes `addSupplementalPlaces`, as `places`, only the place TIGER features whose GEOID was imported as a `place:GEOID:<geoid>` location path. These are the polygons that decide whether a county subdivision is `covered`.
- Each `LocationPathGeometries` record that `transform.ts:transform` emits is keyed by the location path's source key and holds `location_path_id`, `geometry` as a JSON string (`JSON.stringify` of the MultiPolygon), `sourceLocationPathKey` equal to the key, and `selectedYear` as a number.
- `transform.ts:toLocationPathSpec` writes `path` only for a state-level location path and defaults `resolution_class` to `primary`.

## Side Effects

- `acquire.ts:acquire` reads `env.CENSUS_GAZETTEER_PAGE_URL` and uses `acquire.ts:DEFAULT_PAGE_URL` when it is not set. A value that is set and blank throws `gov/census/www2/gazetteer: CENSUS_GAZETTEER_PAGE_URL is set and blank` before any request.
- `acquire.ts:acquire` fetches the Gazetteer page, `acquire.ts:TIGER_INDEX_URL`, each TIGER directory index, and every source file, all through `acquire.ts:fetchOk`. When the selected shared year is older than the newest year on the Gazetteer page, it also fetches that year's own Gazetteer page.
- `acquire.ts:acquire` writes the source files into `sourceDir` through `downloadGazetteerSources` and logs discovery, the selected year, and the file count.
- `transform.ts:transform` reads the Gazetteer zips, the hierarchy file, and the TIGER zips from the input paths.
- `transform.ts:transform` creates the `deps.state` directory and writes `local-jurisdictions-<year>.json` there, the report of included, covered, and excluded supplemental places. The `lib` code it calls also writes extracted shapefiles and the per-state hierarchy files under `deps.state`.
- `transform.ts:transform` calls `deps.emit("LocationPathGeometries", ...)` once per geometry row and logs the report counts and path.

## Verification

- Run: `npx vitest run test/sources/us-census-gazetteer`
