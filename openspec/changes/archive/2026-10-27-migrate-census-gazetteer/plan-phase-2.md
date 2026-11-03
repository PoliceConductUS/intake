# Census Gazetteer Migration — Phase 2 (Domain Port) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Port the gazetteer's domain logic (~1.7k LOC) into `sources/census-gazetteer/` running on the Phase-1 runtime — a **faithful** port whose per-module behavior is pinned by the original's own tests and whose end-to-end output is record-identical (verified small-scale here, full-scale in Phase 3). Delete the plumbing + dead code.

**Architecture:** `sources/census-gazetteer/config.ts` exports `run(deps)` (deps: `paths`, injected `state` + `emit`; parse helpers imported directly from `src/cli/run/parse/`). It matches input files by basename, parses the 3 Gazetteer files, derives the place↔county hierarchy (cached in `state`), builds LocationPaths/Aliases (returned in the manifest), and streams LocationPathGeometries via `emit`. Domain modules live in `sources/census-gazetteer/lib/`, ported near-verbatim with only their I/O edges rewired.

**Port strategy (faithful):** for each domain module, **copy it + its original test + fixtures** into `sources/census-gazetteer/lib/`, rewire only the I/O edges (file reads → parse helpers / passed text; caches → `state`; drop plumbing imports), and get the ported test green. The original test suite (~3.1k LOC) is the fidelity harness. Preserve algorithms + **sort order verbatim** (see Constraints).

**Tech Stack:** TS (ESM/NodeNext, `.js`), Vitest, Phase-1 parse helpers + `emit`/`state`, `polygon-clipping` (tiger-hierarchy dep — add it), existing `polygon-clipping`/geometry math from the original.

## Global Constraints (record-identical invariants — copy verbatim)

- **Sort order (must reproduce exactly):** all keyed collections (LocationPaths, LocationPathAliases, and the geometry `emit` sequence) ordered by `String.localeCompare` on their path/key; the **hierarchy overlap list** ordered by the compound key `` `${stateGeoid}:${placeGeoid}:${administrativeAreaGeoid}:${sourceKey}` `` via `localeCompare` (note: state→**place**→adminArea→sourceKey). `warnings` by default `Array.sort()`.
- **Geometry record shape** (matches runtime `LocationPathGeometrySpec`): `emit("LocationPathGeometries", path, { location_path_id, geometry, sourceLocationPathKey: path, selectedYear })`.
- **No `LocationPathSources` kind** in the target — drop that sidecar entirely (it's not an import artifact kind).
- Determinism: no network, clock, randomness. Discovery/download are OUT (inputs arrive as `paths`).
- Parse helpers imported directly; only `state`/`emit`/`paths` via `RunDeps`.
- ESM `.js` specifiers; DRY; Conventional Commits; tests under `test/`. Ignore the pre-existing `supabase/seed.sql` suite failure.

## Tasks

### Task 1 — Input matching + year extraction (`lib/inputs.ts`)

Classify `paths[]` by `path.basename` into `{ statesZip, adminAreasZip, placesZip, stateTigerZip, countyTigerZip, placeTigerZips[], hierarchyFile? }` using basename-adapted regexes (from `census-discovery.js:157-191`): `/gaz_state|state_national/i`, `/gaz_count|counties_national/i`, `/gaz_place|place_national/i`, `/tl_\d{4}_us_state\.zip/i`, `/tl_\d{4}_us_county\.zip/i`, `/^tl_\d{4}_\d{2}_place\.zip$/i`, hierarchy `/relationship|rel20\d{2}/i`. Singletons throw on 0/>1; place-TIGER requires ≥1; hierarchy optional. Extract `selectedYear` from filenames and **cross-check all agree (fail loudly on mismatch)** — new check replacing discovery's single `links.year`. TDD with filename-list fixtures.

### Task 2 — Port `gazetteer-parser` + gazetteer schemas (`lib/gazetteer-parser.ts`, `lib/schemas.ts`)

Copy `parseGazetteerFile` + `requiredColumnsByType` + the gazetteer Zod schemas. **Rewire edge:** it currently `readFile(filePath)`; change it to accept **text** (the caller reads the `.txt` entry from the zip via `readZipEntryText`). Preserve the header-driven column pick + per-row Zod validation. Drop `writeNormalizedRecordsArtifact`. Port the original `gazetteer-parser.test.js` (fixtures) → green.

### Task 3 — Port `location-paths` (`lib/location-paths.ts`) + `allowedStateSlugs`

`buildLocationPaths({states, administrativeAreas, places, hierarchy}) → { locationPaths, locationPathSources, locationPathAlias, locationPathAliasSources, warnings }` is **pure**. Copy verbatim; replace the `address-location-evidence` import with a tiny `lib/constants.ts` holding just `allowedStateSlugs` (+ `allowedStateGeoids`, deduped with tiger-hierarchy). Keep `sortedObject` sorting verbatim. Port `location-paths.test.js` → green.

### Task 4 — Port `tiger-hierarchy` (`lib/tiger-hierarchy.ts`) — the heavy one

Copy `buildHierarchyFromTiger` (O(places×counties) bbox-prefilter + `polygon-clipping` intersection), `readFeaturesByState`, `toClippingGeometry`. Add dep `polygon-clipping`. **Rewire edges:** (a) `readFeaturesByState` reads via `deps.readShapefile`/`deps.readGeoJson` (extract the `.shp`/`.geojson` from the tiger zip via `readZipEntryBuffer`/a temp path — decide the shapefile-from-zip mechanism); (b) the per-state hierarchy cache read/write → `path.join(state, "hierarchy", "<geoid>.json")` (fixing the original's mis-placement under the per-run dir); (c) drop `logger`/`progressLogger`/`consoleProgress` (call sites already `?.`-guard). Preserve the compound-key final sort verbatim. Port `tiger-hierarchy.test.js` → green.

### Task 5 — Port `location-geometries` (`lib/location-geometries.ts`)

Copy `buildLocationPathGeometryPackage` (pure over extracted geometry paths via `readFeaturesByState` + `toClippingGeometry`). Keep the `onGeometryRow` seam: when provided, the geometry Map is never allocated (bounded memory). Drop the `locationPathSourceCache` bbox/centroid cache for the first cut (recompute — **no output difference**, only slower reruns). Preserve the lexical emit order. Port `location-geometries.test.js` → green.

### Task 6 — Port `hierarchy-parser` (`lib/hierarchy-parser.ts`) — optional path

`parseHierarchyRelationshipFile` (rare; only when a relationship file input is present). Rewire `readFile`→text. Port its test → green. (Low priority — the TIGER path is primary.)

### Task 7 — `config.ts run()` orchestration + end-to-end fidelity

Write `sources/census-gazetteer/config.ts` `run(deps)` wiring the stages per the investigation skeleton: match inputs (Task 1) → parse gazetteer files (Task 2, reading zip text) → hierarchy (Task 4 TIGER path, cache in `state`) → `buildLocationPaths` (Task 3) → `buildLocationPathGeometryPackage` with `onGeometryRow → emit` (Task 5) → return `{ artifacts: [LocationPaths, LocationPathAliases?] }`. **Fidelity test:** run against a **small real subset** (1–2 states' actual gazetteer + TIGER files, sourced from `intake-workspace/dev/us-census-gazetteer/state/sources/2025/`) and assert the emitted LocationPaths/Aliases + streamed geometry records are **record-identical** to the original producer's output for that subset.

## Deferred to Phase 3

- Full 50-state golden run against `dev`; deleting the standalone `intake.census-gazetteer` repo once parity is proven; the `location-hierarchy-overrides` decision; re-adding the bbox/centroid perf cache if reruns are too slow.

## Open Questions (confirm before/at start)

- **Shapefile-from-zip mechanism** (Task 4): extract `.shp/.dbf/.shx` from the TIGER zip to a temp dir then `readShapefile(path)`, or teach `readShapefile` to read from a zip entry? (Lean: extract to a temp dir under `state` — simplest, matches `shapefile.open`'s file-path API.)
- **Drop the bbox/centroid perf cache** for the first cut (Task 5)? (Lean: yes — no output difference.)
- **Fidelity subset** (Task 7): which 1–2 states, and record-identical vs byte-identical.
