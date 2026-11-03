## Design Summary

Migrate the standalone `intake.census-gazetteer` producer (7.8k LOC) onto the Slice-1
`config.ts` / `run()` model — the hardest source, and the proof the model scales. It collapses
to ~2k LOC of domain logic: ~1.4k of plumbing is deleted (the runtime owns it) and ~470 LOC of
dead/unwired code is dropped.

It forces the runtime to grow beyond Slice 1: a **streaming emit sink** (for ~32k
full-resolution TIGER geometries — bounded memory), **parse helpers** (pipe-delimited text /
zip / shapefile→GeoJSON), and the **injected persistent `state`** grant (for the per-state
hierarchy cache and digest short-circuit). Census **download/discovery moves out** of `run()`
— acquisition is the separate system; files arrive as inputs.

Full detail, decisions (D1–D8), risks, and the phased plan are in `design.md`.

## Alternatives Considered

### Approach A: Emit-sink streaming + download-out — CHOSEN

- `run()` returns a manifest for bounded kinds and streams geometries via an injected sink
  (threading the domain code's existing `onGeometryRow` seam); census files are provided as
  inputs.
- **Why selected:** bounded memory for ~GB of geometry, reuses an existing seam, and honors
  the two-system acquisition boundary. Settles D10 for the genuinely-huge-source case.

### Approach B: Pure manifest-return + big heap

- Keep Slice 1's manifest-only contract and size Node's heap for the full geometry set.
- **Why not:** fragile at national scale, and doesn't generalize to bigger sources; the emit
  seam already exists in the domain code, so streaming is low-cost.

### Approach C: Keep download/discovery inside `run()`

- Port the census.gov scraping + zip/shapefile fetching into the source module.
- **Why not:** violates the acquisition boundary (intake starts from saved files) and makes
  `run()` non-deterministic/network-bound.

## Agreed Approach

Approach A. Evolve the runtime (emit sink + parse helpers + injected `state`), provide census
files as inputs, port the ~2k LOC of domain logic into `sources/census-gazetteer/`, delete the
plumbing and dead code, and prove fidelity with a record-identical golden regression test.

## Key Decisions

- Geometries stream via `deps.emit`; bounded kinds return in the manifest.
- Download/discovery is out of `run()`; files are inputs.
- New injected parse helpers (delimited/zip/shapefile/GeoJSON) and a persistent `state` dir.
- Preserve today's (unwired) overrides behavior; don't port dead code.
- Golden regression: same inputs → record-identical LocationPaths/Aliases/Geometries.

## Open Questions

See `design.md` §Open Questions — chiefly: overrides (implement vs leave unwired), whether the
~32k LocationPaths also need streaming, golden-test granularity, and the runtime state-cache
convention.
