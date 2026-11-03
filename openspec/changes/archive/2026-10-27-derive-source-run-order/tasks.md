# Tasks — Derive source run order from produced/consumed kinds

Scope: replace the census-first special case with a run order derived by topo-sorting
the selected sources over the `produces`/`consumes` kinds they declare. Fail loud on
cycles and emitted-kind drift. Selected-set-only semantics (ADR 0015 preserved).
No envelope kind, durable change type, DB migration, or event transport.

## 1. Declaration surface on the source-module contract

- [x] 1.1 Sources export `produces: readonly ImportArtifactKind[]` (the only new
      declaration). Read + validated on the run path via `loadSourceProduces`
      (`load-source-module.ts`); `describe-sources.ts` left unchanged — `produces` is a
      run-time requirement, not a listing one, so the listing contract stays stable.
- [x] 1.2 Implement `consumesOf(produces)` (`source-order.ts`): derive the consumed set
      as `⋃ FK_targets(k) for k in produces` (from the generated `FK_REFERENCES`, mapped
      singular→plural via the registry `recordKind`) `− produces`. Unit-tested against
      `FK_REFERENCES` — a civil-case source resolves to `{LocationPaths, AgencyPersonnel}`
      and NOT `Agency`/`Personnel` (transitive, not direct).
- [x] 1.3 Validate at load in `loadSourceProduces`: `produces` present, non-empty, every
      entry ∈ `IMPORT_ARTIFACT_KINDS`. Fails before any DB read/write. Unit-test each
      failure.

## 2. Source-order planner (topological sort)

- [x] 2.1 Factored a generic `topologicalOrder(nodes, edges)` (`source-order.ts`) with
      Kahn + descending-out-degree/id tiebreak and cycle detection, mirroring the pattern
      in `src/shared/io/import-types.ts`. Extracting it makes cycle detection testable
      (the real FK graph is a DAG).
- [x] 2.2 Implemented `planSourceOrder(sources)`: builds `producersOf` from `produces`,
      adds edge A→B when `consumesOf(B) ∩ A.produces ≠ ∅` (A ≠ B), topo-sorts, and returns
      the ordered ids plus per-edge `{before, after, kind}` for explainability.
- [x] 2.3 Cycle → fail-loud error naming the cycle's sources and the kind on each edge.
- [x] 2.4 Unit-tested: producer-before-consumer; the full 8-source worked example; a
      single consumer alone (no producer in set); a synthetic 2-source cycle aborts;
      determinism regardless of input order; edges exposed.

## 3. Wire into `intake run` and remove the special case

- [x] 3.1 `src/cli/source-glob.ts`: removed the `CENSUS_SOURCE_ID` special case;
      `matchSourceIds` now also filters to real sources (folders with `run.ts`), so
      `sources/lib/` is never treated as a source.
- [x] 3.2 `src/cli/run/index.ts`: loads each matched source's `produces`, calls
      `planSourceOrder`, logs the derived order and forcing edges once (multi-source
      runs), then iterates in derived order. Missing `produces`/cycles fail loud before
      any source runs. No plan-only flag; `--dry-run` keeps its meaning.
- [x] 3.3 Emitted-kind drift check (after `sink.flush`): the source's emitted kinds
      (manifest + sink refItems) must be ⊆ declared `produces`, else abort with the
      undeclared kind + source id. Unit-tested.

## 4. Declare produces for all existing sources

- [x] 4.1 Added an accurate `produces` export to all 8 sources (census also declares
      `LocationPathGeometries`, emitted via the streaming sink). The `consumesOf`
      derivation supplies each consumed set — no hand-declared `consumes`.
- [x] 4.2 Integration test (`source-order.integration.test.ts`) asserts the derived
      `run "*"` order over the real sources matches the design worked example, and that
      `lib` is not a source.

## 5. Docs + validation

- [x] 5.1 ADR 0021 committed; refines ADR 0015's ordering statement, leaves ADR 0015
      decisions 1–5 unchanged.
- [x] 5.2 Updated the `intake run` command help (dropped "census first, else name
      order"; describes the derived order). ADR 0015's own text is left as-is —
      ADR 0021 supersedes its ordering claim.
- [x] 5.3 `npm run validate` green (format, lint, 406 tests, build, openspec). No
      Supabase migration/seed touched.
