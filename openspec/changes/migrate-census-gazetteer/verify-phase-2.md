# Verify — Census Gazetteer Migration, Phase 2 (Domain Port)

## Overall Decision

- [ ] ✅ PASS
- [x] ⚠️ PASS WITH WARNINGS
- [ ] ❌ FAIL

Phase 2 is complete on branch `migrate-census-gazetteer` (not merged). The gazetteer's domain
logic is ported into `sources/census-gazetteer/` on the Phase-1 runtime, and the port is
**validated record-identical** against the original producer on a full real state (Vermont).
The only warnings are the pre-existing unrelated test-suite failure and the deferral of the
full 50-state golden run to Phase 3.

Phase-2 code commits: `067ccde..7abc77e`. Base: `f1ba652`.

## Fidelity gate (the decisive check)

Ran the ported `run()` on **real** Vermont-subset inputs (VT-filtered gazetteer + national
state/county TIGER + `tl_2025_50_place.zip`) and diffed the emitted `/vt/` records against the
original producer's cached national output filtered to `/vt/`:

- **195 `/vt/` LocationPaths ported == 195 original; 0 field-level mismatches; 195 geometries
  emitted → RECORD-IDENTICAL.**
- This validates the whole pipeline end-to-end on real data, in particular the
  `toLocationPathSpec` mapper (centroid/bbox/slugs/names/parents), which was the one
  unverified fidelity risk from Task 7.
- The core overlap engine (`tiger-hierarchy`) was separately verified **verbatim-equivalent**
  to the original by a top-tier line-by-line review (Task 4).

(One-off validation harness `fidelity-vt.mts` was removed after the run — it used
machine-specific dev paths. Phase 3 should build a parameterized fidelity harness.)

## Task coverage (plan-phase-2)

- **Task 1** input matching + year cross-check — regexes validated against the real cached
  filenames.
- **Tasks 2–6** faithful JS→TS ports (gazetteer-parser, location-paths, tiger-hierarchy [opus
  verbatim review], location-geometries [onGeometryRow seam, perf cache dropped],
  hierarchy-parser), each pinned by ported/added tests.
- **Task 7** `config.ts run()` orchestration + synthetic e2e + strict-schema-valid manifest.

## What the port achieved

- The **7,796-LOC standalone producer** collapses to a `sources/census-gazetteer/` module
  (config.ts + `lib/*` ≈ 2k LOC of domain logic). ~1.4k LOC of plumbing (workspace, shared-IO,
  logger, command, digest, envelope writing, download/discovery) is gone — owned by the
  runtime; ~470 LOC of dead code dropped.
- Discovery/download are OUT (files arrive as `paths`); geometries stream via `emit` (bounded
  memory); the hierarchy cache now correctly persists under `state` (fixing a latent bug where
  the original wrote it under the per-run dir).

## Checks

1. **Typecheck:** `npx tsc --noEmit` clean.
2. **Tests:** `npm test` → **275 passed**; one pre-existing unrelated failure
   (`test/seed-display.test.ts`, missing local `supabase/seed.sql`).
3. **Formatting:** all Phase-2 files Prettier-clean (formatted explicitly; the repo's `lint`
   doesn't run Prettier).
4. **Working tree clean;** no forbidden runtime/import-pipeline changes (Phase 2 only added the
   source module + used Phase-1 deps).

## Deferred to Phase 3

- **Full 50-state golden run** against `dev`, with a deep geometry-record comparison (not just
  LocationPaths) — the complete parity proof. VT proves fidelity; scale + all-states is Phase 3.
- A reusable, parameterized fidelity harness.
- Deleting the standalone `intake.census-gazetteer` repo once full parity is proven.
- The `location-hierarchy-overrides` decision (unwired today) and re-adding the bbox/centroid
  perf cache if full-run rerun times demand it.

## Follow-ups (non-blocking; from reviews)

- `src/cli/run/parse/geo.ts` `readGeoJson` returns features only for `type === "FeatureCollection"`
  (irrelevant for TIGER; noted for completeness).
- Phase-1 note: `makeWorkspace` now runs before `run()`, so a failing run leaves an empty
  command dir — consider cleanup-on-failure.
