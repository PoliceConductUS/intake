# Verify — Census Gazetteer Migration, Phase 3 (Full Golden Run)

## Overall Decision

- [x] ✅ PASS

The ported `sources/census-gazetteer/` module reproduces the original standalone producer's
output **byte-for-byte at full national scale.** The migration is validated end-to-end.

## Full 50-state golden comparison

Ran the ported `run()` on the **complete** real input set (national gazetteer + national
state/county TIGER + all **51** place-TIGER zips) and compared every emitted record against the
original producer's cached national output (`intake-workspace/dev/us-census-gazetteer/runs/…`):

```
LocationPaths        : ported 35249 / original 35249   mismatches 0   only-ported 0   only-original 0
LocationPathAliases  : ported  1456 / original  1456   mismatches 0   only-ported 0   only-original 0
LocationPathGeometries: emitted 35249 / original 35249  mismatches 0   missing-in-original 0
TOTAL DIFFERENCES: 0  →  FULL 50-STATE RECORD-IDENTICAL ✅
```

- LocationPaths + Aliases compared in memory; the ~35k full-resolution geometry records
  compared per-key by streaming (bounded memory), deep-equal on the parsed spec.
- Runtime: ~650s (parse all TIGER + place↔county overlap for every state + geometry compare).

## Bug found + fixed by the full run

The full comparison caught one real defect the Phase-2 VT check missed (VT compared only
LocationPaths): the ported geometry `emit` set `selectedYear` to the **string** `"2025"`
(parsed from the input filename), while the original stores the **number** `2025`. All 35,249
geometries differed on that single field; LocationPaths/Aliases (which carry no `selectedYear`)
were already identical. Fixed in `fc7f259` (`Number(inputs.year)` at the emit + a
`typeof … === "number"` test assertion); the re-run is `0` differences.

## Checks

- Full golden run: **0 differences** across 71,954 records (35249 paths + 1456 aliases + 35249
  geometries).
- Tests pass, typecheck clean, working tree clean, files Prettier-clean (Phases 1–3).
- The one-off comparison harnesses (`fidelity-vt.mts`, `fidelity-full.mts`) were removed after
  use (machine-specific dev paths). The comparison method is documented here for reproducibility.

## Migration status — COMPLETE

- **Phase 1 ✅** runtime evolutions (parse helpers, injected `state`, streaming `emit`).
- **Phase 2 ✅** domain port (~2k LOC into `sources/census-gazetteer/`; ~1.4k plumbing deleted,
  ~470 dead code dropped); VT record-identical.
- **Phase 3 ✅** full 50-state record-identical parity.

The `intake.census-gazetteer` standalone producer (7,796 LOC) is now **proven redundant** — its
output is exactly reproduced by the config-driven source module. It is safe to retire.

## Remaining (owner's call — outward-facing / policy)

- **Delete the `intake.census-gazetteer` sibling repo** once you're satisfied (left undone — it's
  an outward-facing removal to do on your say-so).
- **Acquisition:** the census download/discovery moved out of `run()`; a separate acquisition
  step (or the acquisition system) must supply the input files. For now they're the ones cached
  in `intake-workspace/dev/us-census-gazetteer/state/sources/`.
- **`location-hierarchy-overrides`** — remained unwired (matching the original's actual behavior);
  implement against `spec.audit.overrides` only if desired.
- **bbox/centroid perf cache** — intentionally dropped (no output effect); re-add under `state` if
  full-run rerun times ever matter (the run took ~11 min here; the expensive per-state hierarchy
  overlap IS cached under `state`).
