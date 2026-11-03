## Context

Migrate the standalone `intake.census-gazetteer` producer (7,796 LOC) onto the Slice-1
`config.ts` / `run()` model — the hardest source, and the real proof the model scales.

Investigation findings:

- **Shrinks dramatically.** Of 4,694 `src` LOC: **~2,000 is domain logic** (census parsing,
  TIGER hierarchy, location-path/geometry derivation), **~1,400 is plumbing the runtime owns**
  (workspace, shared-IO, logger, command, digest, envelope writing) → deleted, **~470 is
  dead/unwired** (`location-hierarchy-overrides` never called; `address-location-evidence`
  ~90% unused) → dropped.
- **Outputs** ~32k location paths (51 states + ~3,143 counties + ~29k places) as
  `LocationPaths` + `LocationPathAliases`, and ~32k `LocationPathGeometries` with
  **full-resolution, unsimplified TIGER polygons** (hundreds of MB–GB). Today it holds the
  whole geometry set in memory before writing; the shared-IO layer already externalizes
  geometries into per-record ref files at write time.
- **Deterministic** given the same acquired bytes; the only non-determinism is the network
  fetch, already injectable (`fetchText`/`fetchBytes` + `file://` fallback).
- **Formats:** pipe-delimited fixed-width text (from zip archives), ESRI shapefiles (`.shp`),
  GeoJSON.
- **Load-bearing caches:** a per-state hierarchy cache (the place↔county overlap is
  O(places×counties)) and a source-digest no-change short-circuit — both use the module's
  state-path.

**Settled decisions (this design):**

- **Geometries stream via an injected emit sink** (bounded memory) — threading the domain
  code's existing-but-unused `onGeometryRow` seam.
- **Download/discovery moves out** of `run()` — the census Gazetteer zips + TIGER shapefiles
  are provided as `input.paths`; acquisition is the separate upstream system.

## Goals / Non-Goals

**Goals**

- A `sources/census-gazetteer/` module (`config.ts` + domain helpers, ~2k LOC) whose `run()`
  parses provided census files and produces `LocationPaths` + `LocationPathAliases` +
  streamed `LocationPathGeometries`.
- Evolve the runtime with: a **streaming emit sink**, **parse helpers** (delimited/zip/
  shapefile/GeoJSON), and the **injected persistent `state`** grant (deferred in Slice 1).
- A **golden regression test**: same input files → record-identical output vs. today.

**Non-Goals**

- Building the acquisition/download system (separate; files are pre-fetched inputs here).
- Wiring `location-hierarchy-overrides` (unwired today — a separate decision, not a silent
  behavior change).
- Porting `address-location-evidence` (dead relative to this pipeline).

## Decisions

### D1. Evolved `run()` contract: manifest for bounded kinds + emit sink for streaming kinds.

`run(deps)` returns a `Manifest` for bounded kinds (LocationPaths, Aliases) **and** streams
large kinds (Geometries) through an injected sink `deps.emit(kind, key, spec)`. The runtime
assembles the `Artifacts` envelope from the returned manifest plus the streamed,
ref-externalized geometry records, then hands it to the existing import pipeline. (This
reconciles Slice 1's manifest-return with the geometry-scale reality; emit is a streaming
dependency, not the primary mechanism.)

### D2. Geometries stream; bounded kinds return in the manifest.

`run` emits each geometry via `deps.emit("LocationPathGeometries", key, spec)` as it's built
(threading `buildLocationPathGeometryPackage`'s existing `onGeometryRow` hook), so peak memory
is one geometry, not ~GB. LocationPaths/Aliases (small specs) return in the manifest. Whether
the ~32k LocationPaths also need streaming is a measurement call (Open Question).

### D3. Acquisition is out; `run()` parses local files only.

Census discovery + download leave `run()`. The Gazetteer zips + TIGER shapefiles are provided
as `input.paths` (a manual pre-fetch for now; the acquisition system automates it later).
Deterministic given the same bytes.

### D4. New runtime parse helpers (injected, like `readXlsx`).

`deps` provides: delimited fixed-width text reader (from zip entries), zip extraction, and a
shapefile→GeoJSON reader (`shapefile` npm) + GeoJSON reader. Each isolated to one runtime
adapter; the source module never imports the parsing libs directly.

### D5. Injected persistent `state` (D9's `statePath`).

`deps.state` is a durable per-source cache dir for the per-state hierarchy cache and the
source-digest no-change short-circuit — load-bearing for incremental performance. This builds
the `state` grant Slice 1 deferred.

### D6. Domain port + deletions.

Port to `sources/census-gazetteer/`: `census-discovery` (parse/select only, no fetch),
`gazetteer-parser`, `hierarchy-parser`, `tiger-hierarchy`, `location-paths`,
`location-geometries`, and the gazetteer record schemas. Delete plumbing (`workspace`,
`intake-shared-io`, `local-envelope-io`, `logger`, `run-reports`, `cli`, `importpackage`,
`source-files` acquire/cache, command schemas). Drop dead code (`location-hierarchy-overrides`,
`address-location-evidence` except its `allowedStateSlugs` constant).

### D7. Golden regression test.

Same input census files → record-identical `LocationPaths`/`Aliases`/`Geometries` vs. the
current producer. CI uses a bounded fixture (one or two states); the full 50-state run is a
manual verification against `intake-workspace/dev`.

### D8. Overrides gap is preserved, not silently changed.

`location-hierarchy-overrides` is designed-but-unwired today (`run.js` hardcodes
`overrides: []`). The migration preserves that behavior; whether to implement overrides
against `spec.audit.overrides` is a separate decision.

## Risks / Trade-offs

- **Peak memory** → mitigated by D1/D2 (geometry streaming).
- **Golden fidelity** → mitigated by D7 (record-identical regression on a state subset).
- **State-cache + digest short-circuit reconciliation** with the runtime workspace model
  (D5) — must land a durable cache location or first runs are much slower.
- **New deps** (`shapefile`, unzip) → isolated behind parse helpers (D4).
- **Overrides** → explicit decision (D8), not a silent drop.

## Phasing

1. **Runtime evolutions** (on the Slice-1 base): streaming emit sink + envelope assembly;
   parse helpers (delimited/zip/shapefile/GeoJSON); injected `state`. Unit-tested standalone.
2. **Domain port:** `sources/census-gazetteer/` (`config.ts` + helpers), files-as-input, using
   the new deps. Delete plumbing + dead code.
3. **Golden regression + full run:** record-identical output on a state subset; then the full
   50-state run against `intake-workspace/dev`, confirming ~32k paths/geometries match.

## Open Questions

- **Overrides:** implement against `spec.audit.overrides`, or leave unwired? (D8)
- **Do the ~32k LocationPaths also need streaming**, or is manifest-return fine (measure)?
- **Golden granularity:** which state subset; record-identical vs byte-identical.
- **State-cache convention** in the runtime workspace (`state` path layout, digest history).
- **Where the pre-fetched census files come from now** (manual download location / a stub
  acquire step) until the acquisition system exists.
