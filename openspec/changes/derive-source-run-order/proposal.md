## Why

`intake run "*"` runs every source in a hardcoded order: `us-census-gazetteer`
first, everything else alphabetically (`src/cli/source-glob.ts`). That single
special case encodes one real constraint — the `location_path` producer must run
before its resolve-or-fail consumers (ADR 0015) — as a magic string, and hides
the rest.

There is a second constraint the magic string does not express. Civil-case
sources (`courtlistener`, `clearinghouse-api`) resolve every record to an
existing `officer@agency` (`AgencyPersonnel`) and drop records that do not
resolve — they never mint an officer. The roster sources (`gov.tx.tcole`,
`mn-post`, `gov.azpost.roster`, `gov.us.federal-le`) are what make those
officers resolvable. In a from-scratch `run "*"`, a civil-case source that
happens to sort before the rosters silently loses coverage. Alphabetical order
gets this wrong (`clearinghouse-api` and `courtlistener` sort before
`gov.*`/`mn-post`).

The real dependency is source→**entity kind**, not source→source: each source
_produces_ some kinds and _consumes_ (references but does not produce) others,
and the consumed kinds are exactly the FK targets of the produced kinds — already
modeled in `FK_REFERENCES`, and topologically sorted at the kind level in
`src/shared/io/import-types.ts`. This change derives a deterministic source
order from the kinds each source declares it produces, replacing the census-first
special case — without any source ever naming another source.

## What Changes

**Source modules declare produced kinds; consumed kinds are derived**

- From: a source exports `run`/`acquire` and an optional `description`; what it
  produces is only known at runtime from the manifest `run` returns; what it
  consumes is nowhere declared.
- To: a source additionally exports `produces: ImportArtifactKind[]` (the kinds
  it emits) — the _only_ new declaration. Its consumed set is **computed**, not
  declared: `consumes = FK_targets(produces) − produces`, using the FK graph
  already in `FK_REFERENCES` (`entity-specs.ts`) — a source's _direct_ FK targets.
  Transitive dependencies are handled by the sort, not by expanding this set.
- Reason: ordering must be computable **before** running; deriving `consumes`
  from `produces` removes a redundant hand-declared surface and its drift risk;
  `FK_REFERENCES` is generated from the DB's real foreign keys and every
  cross-entity reference is an FK, so it is the _complete_ dependency set — no
  separate consumed declaration is needed. Declarations reference kinds (not
  sources), keeping ADR 0015 isolation intact.
- Impact: additive to the source-module contract. Every existing source gains a
  `produces` export.

**Direct FK targets suffice; the sort handles transitivity**

- A source's consumed set holds only _direct_ FK targets. Ordering on direct
  edges still guarantees full transitive integrity: a producer of `AgencyPersonnel`
  necessarily makes its own FK targets (`Agency`, `Personnel`) resolvable, so a
  consumer of `AgencyPersonnel` need not list them — sorting after the producer
  already guarantees they are present. Induction over the FK graph generalizes
  this. Expanding the set to the transitive closure would be redundant and would
  assert edges a source does not have.

**Derived, deterministic run order replaces the census special case**

- Order = topological sort over the _selected_ sources: A precedes B when
  B's consumed set intersects `A.produces`. Ties break by descending out-degree,
  then source id (deterministic). `us-census-gazetteer`-first becomes emergent
  (it is the sole `LocationPaths` producer), not hardcoded.
- The `CENSUS_SOURCE_ID` special case in `src/cli/source-glob.ts` is removed.

**Ordering constrains only the selected set (ADR 0015 preserved)**

- Selecting a consumer does not pull in its producers; a consumed kind produced
  by no selected source is not an ordering error. The 3-step resolver (current
  envelope → intake state → database) still lets any subset run in any order
  across runs; truly-absent resolve-or-fail references fail loud at runtime,
  unchanged (ADR 0006).

**Fail-loud validation**

- A cycle in the selected source graph aborts the run and names the cycle.
- After a source runs, its emitted kinds must be a subset of its declared
  `produces`; an undeclared emitted kind aborts the run (declaration drift) —
  this keeps `produces`, and therefore the derived consumed set, honest.
- Every `produces` entry must be a real `ImportArtifactKind` value (validated at
  load).

**Explainability**

- `intake run` logs the derived order and, for each precedence edge, the
  consumed kind and producing source that forced it. This is log output on the
  normal run path; no separate plan-only flag is added.

**Explicitly reused unchanged**: the `Artifacts` envelope contract, the import
pipeline, `SourceNameToCanonicalId`, `DatabaseMutations`, the command directory.
No new envelope kind, no durable change type, no schema/migration change.

## Capabilities

### New Capabilities

- `derive-source-run-order`: Compute a deterministic multi-source run order by
  topologically sorting the selected sources over the entity-kind graph — each
  source's `produces` plus its consumed set derived from `FK_REFERENCES` — with
  fail-loud cycle detection, emitted-kind drift detection, and selected-set-only
  semantics that preserve cross-run "any subset, any order."

### Modified Capabilities

- `config-driven-source-import`: the source-module contract gains a `produces`
  export; the `run` command consumes the derived order.

## Impact

- **New code**: a `produces` declaration surface on the source-module contract;
  a consumed-set derivation from `FK_REFERENCES`;
  a source-order planner (topological sort + cycle/drift validation), factored to
  reuse the kind-level toposort pattern in `src/shared/io/import-types.ts`;
  wiring in `src/cli/run/index.ts` to run in the derived order and log it.
- **Changed code**: `src/cli/source-glob.ts` loses the `CENSUS_SOURCE_ID`
  special case (now emergent); `describe-sources.ts` / `load-source-module.ts`
  surface the new export.
- **Every existing source module** gains a `produces` export (8 sources).
- **Docs**: ADR 0021 (this change's decision record) refines ADR 0015's
  ordering statement; ADR 0015 decisions 1–5 are unchanged.
- **No** database migration, seed change, or generated-type change. Env
  unchanged.
- **Out of scope**: source-to-source `dependsOn`, auto-pulling producers into a
  run, parallel execution of independent sources, scheduling/triggers (later),
  cross-source dedup/merge (ADR 0015 revisit trigger).
