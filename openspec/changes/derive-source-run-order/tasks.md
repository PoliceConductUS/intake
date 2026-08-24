# Tasks — Derive source run order from produced/consumed kinds

Scope: replace the census-first special case with a run order derived by topo-sorting
the selected sources over the `produces`/`consumes` kinds they declare. Fail loud on
cycles and emitted-kind drift. Selected-set-only semantics (ADR 0015 preserved).
No envelope kind, durable change type, DB migration, or event transport.

## 1. Declaration surface on the source-module contract

- [ ] 1.1 Add `produces: readonly ImportArtifactKind[]` (the only new declaration) to
      the source-module contract types (alongside `run`, `acquire`, `description`).
      Update `describe-sources.ts` `SourceDescription` to carry it.
- [ ] 1.2 Implement `consumesOf(descriptor)`: derive the consumed set as
      `⋃ FK_targets(k) for k in produces` (from `FK_REFERENCES`) `− produces`. Unit-test
      against `FK_REFERENCES` — including that a civil-case source resolves to
      `{LocationPaths, AgencyPersonnel}` and NOT `Agency`/`Personnel` (transitive, not
      direct).
- [ ] 1.3 Validate declarations at load in `load-source-module.ts`: `produces` present;
      every entry ∈ `IMPORT_ARTIFACT_KINDS`. Invalid declaration fails before any DB
      read/write. Unit-test each failure.

## 2. Source-order planner (topological sort)

- [ ] 2.1 Factor a generic `topoSort(nodes, edgesFrom, tiebreak)` with cycle detection,
      reusing the pattern in `src/shared/io/import-types.ts:154-193`; have the kind graph
      and the source graph share it (or mirror it — decide here).
- [ ] 2.2 Implement `planSourceOrder(selected: SourceDescription[])`: build
      `producersOf` from `produces`; add edge A→B when `consumesOf(B) ∩ A.produces ≠ ∅`
      (A ≠ B); topo-sort; tiebreak by descending out-degree, then source id. Return the
      ordered ids plus, per edge, `{before, after, kind}` for explainability.
- [ ] 2.3 Cycle → throw a fail-loud error naming the cycle's sources and the kind on
      each edge.
- [ ] 2.4 Unit-test the planner: producer-before-consumer; the full 8-source worked
      example from design.md; subset with an unproduced consumed kind (no error, single
      node runs); a constructed 2-source cycle aborts; determinism on repeat.

## 3. Wire into `intake run` and remove the special case

- [ ] 3.1 `src/cli/source-glob.ts`: delete the `CENSUS_SOURCE_ID` special case;
      `matchSourceIds` returns the matched set (unordered). Update its tests.
- [ ] 3.2 `src/cli/run/index.ts`: load each matched source's descriptor, call
      `planSourceOrder`, log the derived order and the forcing edges once, then iterate
      the run loop in derived order. (No plan-only flag — logging on the normal path;
      `--dry-run` keeps its existing meaning.)
- [ ] 3.3 Emitted-kind drift check: after a source's `run` returns, assert emitted kinds
      ⊆ declared `produces`; abort with the undeclared kind + source id otherwise.
      Unit-test the abort.

## 4. Declare produces for all existing sources

- [ ] 4.1 For each of the 8 sources (`us-census-gazetteer`, `gov.azpost.roster`,
      `gov.tx.tcole`, `mn-post`, `gov.us.federal-le`, `clearinghouse-api`,
      `courtlistener`), read its `run.ts` manifest and add an accurate `produces` export.
      The `consumesOf` derivation (1.2) supplies each source's consumed set — no
      hand-declared `consumes`.
- [ ] 4.2 Assert the derived order for `run "*"` matches the design.md worked example
      (integration test over the real source descriptors).

## 5. Docs + validation

- [ ] 5.1 ADR 0021 committed (this change's decision record); confirm it refines ADR
      0015's ordering statement and leaves ADR 0015 decisions 1–5 unchanged.
- [ ] 5.2 Update any docs/CLI help that describe "census first, else alphabetical".
- [ ] 5.3 `npm run validate` (OpenSpec + typecheck + lint + tests) green. No Supabase
      migration/seed touched, so no reset/integrity assertions needed.
