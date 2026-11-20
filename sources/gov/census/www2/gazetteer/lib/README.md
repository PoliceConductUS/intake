# gov/census/www2/gazetteer/lib

## Overview

The parsing and building code behind the `gov/census/www2/gazetteer` transform. It classifies the acquired input files, parses Census Gazetteer and hierarchy relationship text, reads TIGER features, works out which administrative area is the parent of each place, builds the location paths and their aliases, adds county subdivisions and consolidated cities, and attaches a geometry, bbox, and centroid to every location path.

## Interface

Input matching:

- `roles.ts:GazetteerRole` - the union of the nine input role names.
- `roles.ts:GAZETTEER_SINGLETON_ROLES` - the five roles that take exactly one file: `statesZip`, `adminAreasZip`, `placesZip`, `stateTigerZip`, `countyTigerZip`.
- `roles.ts:CONSOLIDATED_CITY_STATES` - the state FIPS codes that have consolidated-city features.
- `roles.ts:classifyGazetteerRole` - `(text) => GazetteerRole | undefined`; the role of a file name or link.
- `inputs.ts:MatchedInputs` - the input paths by role, plus the shared `year`.
- `inputs.ts:matchInputs` - `(paths) => MatchedInputs`; classifies and validates the input paths.

Parsing:

- `constants.ts:allowedStateGeoids`, `constants.ts:allowedStateSlugs` - the 50 states and DC, as FIPS GEOIDs and as lowercase USPS abbreviations. A row or feature of any other state is outside this source's scope.
- `constants.ts:SOURCE_ID` - `"gov/census/www2/gazetteer"`.
- `constants.ts:OUTSIDE_ALLOWED_STATES` - `"outside 50 states plus District of Columbia"`, the reason a row or feature of another state is counted under.
- `constants.ts:RowCounts` - `{ read, emitted, reported, notSelected }`, the counts of one input; `constants.ts:rowCounts` makes one with zero counts and `constants.ts:countNotSelected` adds one to a reason.
- `schemas.ts:gazetteerStateRecordSchema`, `schemas.ts:gazetteerAdministrativeAreaRecordSchema`, `schemas.ts:gazetteerPlaceRecordSchema` - strict Zod schemas for one Gazetteer row, with a 2-digit, 5-digit, and 7-digit `GEOID`.
- `schemas.ts:deterministicTotalAreaOverlapRecordSchema` - strict Zod schema for one place-to-administrative-area overlap record.
- `schemas.ts:GazetteerStateRecord`, `schemas.ts:GazetteerAdministrativeAreaRecord`, `schemas.ts:GazetteerPlaceRecord`, `schemas.ts:DeterministicTotalAreaOverlapRecord` - the types inferred from those schemas.
- `gazetteer-parser.ts:GazetteerRecordType`, `gazetteer-parser.ts:GazetteerRecordByType` - the record type names `state`, `administrative_area`, `place`, and the record type for each.
- `gazetteer-parser.ts:requiredColumnsByType` - the required header columns for each record type.
- `gazetteer-parser.ts:parseGazetteerFile` - `(text, type) => records`; parses pipe-delimited Gazetteer text.
- `hierarchy-parser.ts:parseHierarchyRelationshipFile` - `(text, selectedYear) => DeterministicTotalAreaOverlapRecord[]`; parses a pipe-delimited relationship file.

TIGER features and hierarchy:

- `extract.ts:extractShapefileFromZip` - `(zipPath, state) => Promise<string>`; extracts the `.shp`, `.dbf`, and `.shx` entries and returns the `.shp` path.
- `tiger-hierarchy.ts:TigerFeatureType`, `tiger-hierarchy.ts:BBox`, `tiger-hierarchy.ts:TigerFeatureRow`, `tiger-hierarchy.ts:BuildHierarchyFromTigerOptions` - the feature and option types.
- `tiger-hierarchy.ts:TigerFeatureTally` - `{ read, outsideStates }`, the number of features read and the number outside the allowed states.
- `tiger-hierarchy.ts:readFeaturesByState` - `(geometryPath, type, state, tally?) => Promise<Map<stateGeoid, TigerFeatureRow[]>>`; reads a `.geojson`, `.zip`, or `.shp` input and adds to `tally` when one is given.
- `tiger-hierarchy.ts:buildHierarchyFromTiger` - `(options) => Promise<DeterministicTotalAreaOverlapRecord[]>`; intersects place and county polygons state by state.
- `tiger-hierarchy.ts:readCachedStateHierarchy`, `tiger-hierarchy.ts:writeCachedStateHierarchy` - read and write one state's hierarchy records under the `state` directory.
- `tiger-hierarchy.ts:toClippingGeometry` - `(geometry) => MultiPolygon | undefined`.
- `tiger-hierarchy.ts:multiPolygonArea` - `(MultiPolygon) => number`.

Location paths:

- `location-paths.ts:buildLocationPaths` - `(input: BuildLocationPathsInput) => BuildLocationPathsResult`; builds state, administrative-area, and place location paths, their source evidence, and the aliases.
- `location-paths.ts:slugFromSourceName` - `(name) => string`.
- `location-paths.ts:HierarchyMatch`, `location-paths.ts:BuildLocationPathsInput`, `location-paths.ts:LocationPathRow`, `location-paths.ts:AlternateAdministrativeArea`, `location-paths.ts:HierarchySelectionReason`, `location-paths.ts:HierarchySelection`, `location-paths.ts:LocationPathSourceEvidence`, `location-paths.ts:LocationPathAliasEntry`, `location-paths.ts:LocationPathAliasSourceEvidence`, `location-paths.ts:BuildLocationPathsResult` - the input, row, evidence, and result types.
- `supplemental-places.ts:addSupplementalPlaces` - `({ built, subdivisions, consolidatedCities, places, counties }) => { built, geometries, report }`; adds county-subdivision and consolidated-city location paths, geometries, and aliases to copies of the built maps.
- `supplemental-places.ts:SupplementalPlaceReport` - one report entry, with `status` `included`, `covered`, or `excluded`.

Geometry:

- `location-geometries.ts:buildLocationPathGeometryPackage` - `(options: BuildLocationPathGeometryPackageOptions) => Promise<BuildLocationPathGeometryPackageResult>`; resolves a MultiPolygon for each location path and computes its bbox and centroid.
- `location-geometries.ts:LocationPathGeometry`, `location-geometries.ts:LocationPathGeometryRow`, `location-geometries.ts:LocationPathBBox`, `location-geometries.ts:LocationPathCentroid`, `location-geometries.ts:LocationPathWithGeometryExtent`, `location-geometries.ts:LocationPathGeometrySourceEvidence`, `location-geometries.ts:BuildLocationPathGeometryPackageOptions`, `location-geometries.ts:BuildLocationPathGeometryPackageResult` - the geometry, option, and result types.

## Invariants

- `inputs.ts:matchInputs`:
  - It throws `gov/census/www2/gazetteer inputs: "<path>" matches no input role` for a path that matches no role.
  - It throws `could not extract a year from "<basename>" (matched role "<role>")` when a matched file name holds no four-digit year.
  - It throws unless each role in `roles.ts:GAZETTEER_SINGLETON_ROLES` has exactly one file, there is at least one place TIGER zip and at most one hierarchy file, and every matched file carries the same year.
  - It throws when the county-subdivision zips do not cover every place state, when the consolidated-city zips do not cover every place state in `roles.ts:CONSOLIDATED_CITY_STATES`, when either list repeats a state, or when either list has a state with no place input.
- `roles.ts:classifyGazetteerRole` tests the role patterns in the fixed order of `roles.ts:ROLE_ORDER` (not exported); the first match wins.
- The four schemas in `schemas.ts` are strict, so an object with an unknown key is rejected. An extra column in a source file is not rejected: `gazetteer-parser.ts:parseGazetteerFile` copies only the columns in `gazetteer-parser.ts:requiredColumnsByType` into the record it validates, and `hierarchy-parser.ts:parseHierarchyRelationshipFile` copies only the columns it names. Other columns are dropped.
- `gazetteer-parser.ts:parseGazetteerFile` throws on an unsupported record type, on a header that lacks a column in `gazetteer-parser.ts:requiredColumnsByType`, and on any row that fails its schema, naming the record number.
- `hierarchy-parser.ts:parseHierarchyRelationshipFile`:
  - It throws on empty text, on a row that fails `schemas.ts:deterministicTotalAreaOverlapRecordSchema`, and with `No authoritative Census hierarchy source was acquired` when it produces no record.
  - It takes each field from the first non-blank column among its header aliases: `stateGeoid`, `STATEFP`, `STATE`; `administrativeAreaGeoid`, `COUNTYGEOID`, `COUNTY_GEOID`, `GEOID_COUNTY`; `placeGeoid`, `PLACEGEOID`, `PLACE_GEOID`, `GEOID_PLACE`; `overlapTotalArea`, `AREALAND`, `AREAPT`, `AREA`; `placeName`, `PLACE_NAME`, `NAME_PLACE`; `placeLabel`, `PLACE_LABEL`, `NAMELSAD`, `NAMELSAD_PLACE`.
  - It throws `Invalid hierarchy relationship record at record <n>: no overlapTotalArea, AREALAND, AREAPT or AREA value` when no area column has a value.
  - `sourceKey` is the row's `sourceKey` column, else `us-census-relationship:<year>:<state>:<county>:<place>`.
- `tiger-hierarchy.ts:buildHierarchyFromTiger`:
  - It works state by state, over the states that have place features. For a state whose cache file exists it takes the cached records and computes nothing.
  - `overlapTotalArea` is `Math.round(area * 1e12)` of the place and county intersection. A pair with a value of 0 or less is dropped.
  - `sourceKey` is `us-census-tiger:overlap:<year>:<state>:<county>:<place>`.
  - It validates every record with `schemas.ts:deterministicTotalAreaOverlapRecordSchema`.
  - It writes a cache file for every state it computes, including a state with no records.
  - It throws `No authoritative Census hierarchy source was acquired` when the result is empty, and returns the records in a fixed sort order.
- `tiger-hierarchy.ts:readCachedStateHierarchy` returns `undefined` only when the file is absent. It throws on any other read or parse error, when the cached `selectedYear` or `stateGeoid` differs from the run, and with a `ZodError` when a cached record fails `schemas.ts:deterministicTotalAreaOverlapRecordSchema`.
- `tiger-hierarchy.ts:addFeatureByState` (not exported):
  - It throws `Invalid Census <type> source identity` for a feature of any type whose `STATEFP` is not two digits, or whose GEOID (`tiger-hierarchy.ts:featureGeoid`, not exported) is not two digits (state), five (county), seven (place or consolidated city) or ten (county subdivision).
  - It leaves out a feature whose `STATEFP` is not in `constants.ts:allowedStateGeoids` and adds one to `outsideStates` of the tally. This is the only feature it leaves out.
  - It throws `gov/census/www2/gazetteer: TIGER <type> <geoid> has STATEFP <fp> and STUSPS <usps>` for a feature of an allowed state whose `STUSPS` is not in `constants.ts:allowedStateSlugs`. A feature without `STUSPS` passes this test.
  - It throws `gov/census/www2/gazetteer: TIGER <type> <geoid> has geometry type <type>, not Polygon or MultiPolygon` for any other geometry.
  - The 2025 TIGER files have no feature that meets a condition that throws.
- `extract.ts:extractShapefileFromZip` throws `No .shp entry found in zip` when the zip has no `.shp` entry, before it creates a directory or writes a file.
- `location-paths.ts:buildLocationPaths`:
  - Every row's key and `location_path_id` is its source key, `<state|administrative_area|place>:GEOID:<geoid>` (`location-paths.ts:sourceKey`, not exported).
  - A state or place whose `USPS` is not in `constants.ts:allowedStateSlugs` is left out and counted under `constants.ts:OUTSIDE_ALLOWED_STATES`. So is an administrative area with such a `USPS` for which no state was built.
  - It throws `gov/census/www2/gazetteer: administrative area <geoid> <name> has no state <geoid> in the Gazetteer states file` for an administrative area of an allowed state for which no state was built.
  - A hierarchy record is emitted when its place was built. A record for another place is counted under `constants.ts:OUTSIDE_ALLOWED_STATES` when its `stateGeoid` is not in `constants.ts:allowedStateGeoids`, and otherwise throws `gov/census/www2/gazetteer: hierarchy record <sourceKey> names place <geoid>, which is not in the Gazetteer places file`.
  - The returned `accounting` holds the `constants.ts:RowCounts` of the states, administrative areas, places and hierarchy records it was given.
  - It throws `Missing Census-proven parent for place` when an in-scope place has no hierarchy match. `location-paths.ts:buildPlaceCandidate` (not exported) throws the same error when a hierarchy match names a state or administrative area that was not built.
  - A place's display name and slug come from the hierarchy match's `placeName` when it is not blank, else from the Gazetteer `NAME`.
  - The default parent of a place is the one with the largest `overlapTotalArea`, with ties broken by path order. Every other parent becomes an alias with the key `<placeKey>:<parentKey>`. A repeated alias key throws `Duplicate Census alias`.
  - `location-paths.ts:addLocationPath` (not exported) throws `Duplicate Census source key` on a repeated source key. Two records with the same path and different GEOIDs do not throw.
- `supplemental-places.ts:addSupplementalPlaces`:
  - It throws on a repeated source, on a class code that is neither excluded nor in `supplemental-places.ts:LOCAL_CLASSES` (not exported; county subdivision) or `C3` (consolidated city), on a malformed `GEOID`, on a `STATEFP` that disagrees with the `GEOID`, on a missing county, a missing name, a missing polygon, on a source key that is already a location path, and on an alias collision.
  - A county subdivision of class `S2`, `S3`, `Z5`, or `Z9` (`supplemental-places.ts:EXCLUDED_CLASSES`, not exported) is reported `excluded` and not added. This applies to county subdivisions only.
  - A county subdivision's parent is the county `STATEFP` + `COUNTYFP`, which must be a built administrative area and must equal the first five digits of the `GEOID`.
  - A county subdivision that the union of the supplied `places` polygons covers completely is reported `covered` and not added.
  - A consolidated city's parent is the county with the largest overlap, with ties broken by key order; each other overlapping county becomes an alias. It throws `Missing Census county intersection` when no built county overlaps.
  - An added row has the key and `location_path_id` `<sourceType>:GEOID:<geoid>`, `level` `place`, `resolution_class` equal to the source type, the trimmed feature label as `display_name`, and `latitude` and `longitude` `"0"`. Its alias keys are `<sourceKey>:<parentKey>`.
- `location-geometries.ts:buildLocationPathGeometryPackage`:
  - It processes location paths in key order.
  - It throws `Missing source key for location path geometry` when a location path has no well-formed source key (`location-geometries.ts:sourceKeyParts`, not exported).
  - A `supplementalGeometries` entry for a location path's key is used in place of the TIGER lookup.
  - Without `onGeometryRow` the rows are returned in `locationPathGeometries`. With it, that field is `undefined`.
  - It throws `gov/census/www2/gazetteer: TIGER <state|county|place> feature <geoid> matches no location path` for a feature of an allowed state that supplies the geometry of no location path. The 2025 files have none.
  - The returned `featureAccounting` holds the `constants.ts:RowCounts` of the state, county and place features: read, emitted as a geometry, and outside the allowed states.
  - bbox and centroid coordinates are rounded to 12 decimal places.
  - The centroid is the centre of the bbox when the polygons have zero total area.
- `location-geometries.ts:geometryForLocationPath` throws `Missing TIGER ... geometry` when a GEOID has no feature and `Unsupported location path level` for an unknown level. `location-geometries.ts:indexFeaturesByGeoid` throws `Duplicate TIGER geometry GEOID`. `location-geometries.ts:toMultiPolygonGeometry` throws `Unsupported TIGER geometry type`. None of the three is exported.

## Side Effects

- `extract.ts:extractShapefileFromZip` creates `<state>/tmp/<zip base name>/` and writes every `.shp`, `.dbf`, and `.shx` entry there under its base name, without the entry's folders. It writes nothing for a zip with no `.shp` entry.
- `tiger-hierarchy.ts:readFeaturesByState` reads the geometry file from disk and, for a `.zip` input, calls `extract.ts:extractShapefileFromZip`.
- `tiger-hierarchy.ts:readCachedStateHierarchy` reads `<state>/hierarchy/<stateGeoid>.json`. `tiger-hierarchy.ts:writeCachedStateHierarchy` creates `<state>/hierarchy/`, writes the temporary file `<state>/hierarchy/<stateGeoid>.json.tmp-<process.pid>`, and renames it to that file.
- `tiger-hierarchy.ts:buildHierarchyFromTiger` reads TIGER features through `tiger-hierarchy.ts:readFeaturesByState` and is the caller of `tiger-hierarchy.ts:readCachedStateHierarchy` and `tiger-hierarchy.ts:writeCachedStateHierarchy`, once per state.
- `location-geometries.ts:buildLocationPathGeometryPackage` reads TIGER features through `tiger-hierarchy.ts:readFeaturesByState` and calls the caller's `onGeometryRow` for each row.
- `location-paths.ts:buildLocationPaths`, `supplemental-places.ts:addSupplementalPlaces`, `gazetteer-parser.ts:parseGazetteerFile`, `hierarchy-parser.ts:parseHierarchyRelationshipFile`, and `inputs.ts:matchInputs` have none.
- No file here makes a network call, reads the environment, or logs.

## Verification

- Run: `npx vitest run test/sources/us-census-gazetteer`
