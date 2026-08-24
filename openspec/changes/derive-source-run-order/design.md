# Design — Derive source run order from produced/consumed kinds

## Goal

Replace the `us-census-gazetteer`-first-else-alphabetical special case in
`src/cli/source-glob.ts` with a run order **derived** from what each selected
source produces and consumes, so that producers precede their consumers
deterministically, sources stay mutually ignorant of one another (ADR 0015),
and any subset still runs in any order across runs.

## The declaration surface

A source module (`sources/<id>/run.ts`) gains one export alongside `run` and
the optional `description`:

```ts
import type { ImportArtifactKind } from "../../src/shared/io/import-type-metadata";

// Kinds this source emits in its manifest. The ONLY declaration a source adds.
export const produces: readonly ImportArtifactKind[] = [
  "Agencies",
  "Personnel",
  "AgencyPersonnel" /* … */,
];
```

A source declares only `produces`. Its **consumed set is derived**, not
declared:

```
consumes(S) = ( ⋃ FK_targets(k) for k in S.produces ) − S.produces
```

`FK_targets` comes from `FK_REFERENCES` (`entity-specs.ts`) — the same
introspected FK graph the kind-level sort already uses. These are the source's
**direct** FK targets; transitivity is the sort's job (next section).

Rule, validated at load (fail-loud): every `produces` entry is a member of
`IMPORT_ARTIFACT_KINDS`.

Why derive rather than hand-declare `consumes`: the consumed set is a pure
function of `produces` and `FK_REFERENCES`, so hand-declaring it is redundant and
adds a drift surface. `FK_REFERENCES` is generated from the database's real
foreign keys, and every cross-entity reference in this system is a foreign key,
so the derivation is a _complete_ account of a source's dependencies — there is
no non-FK ("soft") dependency to declare. (Resolution-by-name-match — e.g.
matching a civil-case officer to an existing `AgencyPersonnel` — is how an FK is
_resolved_, not a dependency without one; the FK to `AgencyPersonnel` already
captures it.) `produces` must still be declared (order must be known **before**
`run()` executes, and the manifest — the only runtime witness of what a source
emits — is the return value of `run()`); the emitted-kind drift check keeps it
honest.

## The algorithm

Given the selected source ids `S` (from the run glob), each source's declared
`produces`, and `consumes(S)` derived as above:

1. Build `producersOf: Map<Kind, Set<sourceId>>` from every selected source's
   `produces`.
2. Edges: for each selected source `B` and each `k ∈ consumes(B)`, for each
   `A ∈ producersOf[k]` with `A ≠ B`, add edge `A → B` ("A before B").
3. Topologically sort with Kahn's algorithm. The **ready set** (indegree 0) is
   drained in a deterministic tiebreak order (see below).
4. A remaining cycle → abort, naming the cycle's sources and the kind on each
   edge.

This reuses the pattern already proven at the kind level in
`src/shared/io/import-types.ts:154-193` (`visitImportKind`, cycle detection).
Factor a small generic `topoSort(nodes, edgesFrom, tiebreak)` and have both the
kind graph and the source graph call it, or mirror it — decided in the plan.

### Transitivity is the sort's job, not the declaration's

`consumes` holds only **direct** FK targets, yet ordering on those edges
guarantees full transitive integrity — the sort composes edges, so `A → B` and
`B → C` place `C` after `A` with no explicit `A → C`. Induction over the FK
graph shows direct edges suffice:

- A civil-case source produces `CivilCaseOfficer`, whose only officer FK is
  `agency_officer_id → AgencyPersonnel`. So `AgencyPersonnel ∈ consumes`, but
  `Agency`/`Personnel` are **not** (the civil source has no direct FK to them).
- The producer of `AgencyPersonnel` (tx/mn) cannot create an `AgencyPersonnel`
  row without satisfying _its_ NOT-NULL FKs to `Agency` and `Personnel` — so it
  either produces them in the same manifest or consumes them (gaining its own
  edge to their producer).
- The civil source sorts after the `AgencyPersonnel` producer, which sorts after
  (or contains) the `Agency`/`Personnel` producers. Transitive integrity holds
  without the civil source ever naming `Agency`/`Personnel`.

Expanding `consumes` to the transitive closure would be redundant and would
assert edges a source does not have.

### Tiebreak among independent sources

**Descending out-degree, then source id.** When two sources have no ordering
constraint between them, the one more other sources depend on (higher
out-degree in the source graph) runs first; remaining ties break alphabetically
by source id. Fully deterministic, and it keeps foundational sources like
`us-census-gazetteer` (out-degree 5 here) at the front without a special case.
Correctness does not depend on the tiebreak — every producer→consumer edge is
already honored by the topo-sort; the tiebreak only orders genuinely
independent sources.

## Worked example (current 8 sources)

`produces` is declared (illustrative — finalized per source during
implementation from each `run.ts` manifest). `consumes` is **derived** from
`FK_REFERENCES` as `FK_targets(produces) − produces`:

| Source                | produces (abbrev.)                                         | consumes (derived)             |
| --------------------- | ---------------------------------------------------------- | ------------------------------ |
| `us-census-gazetteer` | LocationPaths, LocationPathGeometries, LocationPathAliases | —                              |
| `gov.azpost.roster`   | Personnel                                                  | —                              |
| `gov.tx.tcole`        | Agencies, Personnel, AgencyPersonnel, Licenses, …          | LocationPaths                  |
| `mn-post`             | Agencies, Personnel, AgencyPersonnel, Disciplines, …       | LocationPaths                  |
| `gov.us.federal-le`   | FederalAgencies, Agencies, FederalAgencyBranches           | LocationPaths                  |
| `clearinghouse-api`   | CivilCases, CivilCaseOfficers, CivilCaseLinks              | LocationPaths, AgencyPersonnel |
| `courtlistener`       | CivilCases, CivilCaseOfficers, CivilCaseLinks              | LocationPaths, AgencyPersonnel |

Worth noting how the derivation lands: the civil sources consume
`AgencyPersonnel` (via `CivilCaseOfficer.agency_officer_id`) and `LocationPaths`
(via `CivilCase.location_path_id`) — but **not** `Agency`/`Personnel`, which are
one FK hop below `AgencyPersonnel` and handled transitively by the sort.

Edges: census → {tx, mn, federal, clearinghouse, courtlistener} (LocationPaths);
{tx, mn} → {clearinghouse, courtlistener} (AgencyPersonnel). `gov.azpost.roster`
and `gov.us.federal-le` produce nothing any other selected source consumes, so
they are independent.

Out-degree (edges out): census 5; tx 2 and mn 2 (→ both civil sources); azpost,
federal, clearinghouse, courtlistener 0.

Derived order (Kahn + out-degree-then-id tiebreak):

1. `us-census-gazetteer` _(out-degree 5 — leads)_
2. `gov.tx.tcole` _(out-degree 2; ties mn on out-degree, wins on id)_
3. `mn-post`
4. `clearinghouse-api` _(all remaining are out-degree 0 → by id)_
5. `courtlistener`
6. `gov.azpost.roster`
7. `gov.us.federal-le`

Every producer precedes its consumers: census before every LocationPaths
consumer; tx and mn before both civil-case sources. The old alphabetical rule
got this wrong — `clearinghouse-api`/`courtlistener` sorted _before_ the rosters,
losing officer resolution in a from-scratch run.

Note `gov.azpost.roster` (Personnel-only) and `gov.us.federal-le` land last as
harmless out-degree-0 ties: no selected source's derived `consumes` names a kind
only they produce, so nothing depends on them. If a civil source's officer FK
were satisfiable by their rows, that FK target would already appear in the
derived `consumes` and insert the edge — the derivation, not a manual knob, is
what would pull them earlier.

## Subset semantics (ADR 0015 preserved)

Ordering sorts only the selected set and never expands it:

- `intake run courtlistener` alone: the graph has one node, no edges. It runs.
  `AgencyPersonnel` is not produced in this run; it is expected to already be in
  intake state / the database from a prior roster run (the 3-step resolver, ADR
  0015). A truly-absent officer still fails resolve-or-fail at runtime (ADR 0006) — unchanged behavior.
- A consumed kind with no producer in the selected set is **not** an ordering
  error and does **not** pull the producer in.

This is the key reconciliation with ADR 0015: the graph orders _relative
position within one run_; the persisted-state guarantee handles _across runs_.

## Fail-loud validation

- **Cycle**: abort before running anything; print each source in the cycle and
  the consumed kind on each edge.
- **Emitted-kind drift**: after a source's `run()` returns, assert
  `emittedKinds ⊆ produces`. A kind emitted but not declared aborts the run
  (the declaration is stale/wrong). This keeps `produces` honest — it is the
  input to ordering, and since `consumes` is _derived_ from `produces`, a wrong
  `produces` would silently mis-order both endpoints.
- **Bad declarations**: a non-`ImportArtifactKind` entry in `produces`, or a
  missing `produces` export, fails at source load.

Not enforced: that everything in the derived `consumes` is produced by _some_
source (selected or not) — by design, since the producer may live only in a past
run's persisted state.

## Explainability

`intake run` logs the derived order once at the start of a multi-source run,
and for each source the edges that placed it (e.g.
`gov.tx.tcole after us-census-gazetteer (LocationPaths)`). This is log output on
the normal run path; no separate plan-only flag is added (`--dry-run` already
plans mutations without applying and stays distinct in meaning).

## What is removed / changed

- `src/cli/source-glob.ts`: delete the `CENSUS_SOURCE_ID` special case;
  `matchSourceIds` returns the matched set (ordering moves to the planner).
- `src/cli/run/index.ts`: order the matched set through the planner, log the
  plan, iterate in derived order.
- `describe-sources.ts` / `load-source-module.ts`: surface + validate `produces`;
  expose a `consumesOf(descriptor)` helper that derives the consumed set from
  `FK_REFERENCES`.
- Each `sources/<id>/run.ts`: add the `produces` export.

## Non-goals

- Source-to-source `dependsOn` (rejected, ADR 0021).
- Auto-pulling producers into a run (rejected — fights persisted state).
- Parallel execution of independent sources (sequential order is unchanged;
  this only decides the sequence).
- Scheduling/triggers, cross-source dedup/merge.

## Resolved decisions

- **Tiebreak**: descending out-degree, then source id (§ Tiebreak above).
- **Declaration surface**: sources declare only `produces`; `consumes` is
  derived as `FK_targets(produces) − produces` from `FK_REFERENCES`. No
  hand-declared `consumes` and no soft-dependency escape hatch — every
  cross-entity reference is an FK, so the derivation is the complete dependency
  set and cannot drift from the FK graph.
- **No plan-only flag**: the derived order is logged on the normal run path;
  `--dry-run` keeps its existing meaning (plan mutations, don't apply).
