# ADR 0021: Derive Source Run Order from Produced and Consumed Kinds

## Status

Proposed

## Context

`intake run "*"` runs every matched source sequentially. The only cross-source
ordering today is a hardcoded special case in `src/cli/source-glob.ts`:
`us-census-gazetteer` sorts first, everything else alphabetically. ADR 0015
justified that single special case — the `location_path` producer must run
before any source whose entities resolve a `location_path`, because those
references are resolve-or-fail (ADR 0006).

ADR 0015 stated the ordering rule as a **single precondition**, not a
dependency graph, and explicitly rejected source-to-source dependencies to keep
namespaces isolated. That was correct for one shared resolve-or-fail concept.
It does not generalize:

- **More shared concepts are arriving.** Civil-case sources (`courtlistener`,
  `clearinghouse-api`) resolve every record to an existing `officer@agency`
  (`AgencyPersonnel`); an officer that cannot be resolved is dropped, not
  minted. The roster sources (`gov.tx.tcole`, `mn-post`, `gov.azpost.roster`,
  `gov.us.federal-le`) are what make those officers resolvable. Running a
  civil-case source before the rosters in a from-scratch run silently loses
  coverage. That is a second ordering constraint the census special case does
  not express.
- **"Census first, else alphabetical" is not explainable.** It encodes one
  real constraint as a magic string and hides the rest. Adding a third
  constraint means adding a second magic string.

The dependency is not source-to-source. It is source→**entity kind**: a source
_produces_ some kinds and _consumes_ (references but does not produce) others.
The entity-kind dependency graph is already modeled and topologically sorted
(`src/shared/io/import-types.ts`, over `dependsOn` in
`import-type-metadata.ts`). We can derive a deterministic source order from the
kinds each source produces and consumes without any source ever naming another
source or namespace.

## Decision

**1. Each source declares only the kinds it produces; what it consumes is
derived.** A source module exports `produces` — the set of `ImportArtifactKind`
it emits. Its consumed set is **computed**, not declared:
`consumes = FK_targets(produces) − produces`, using the FK graph already in
`FK_REFERENCES` (`entity-specs.ts`). These are a source's **direct** FK targets;
transitive dependencies are handled by the sort, not by expanding this set (see
decision 3). `FK_REFERENCES` is generated from the database's actual foreign
keys, and every cross-entity reference in this system is a foreign key, so it is
a _complete_ account of a source's dependencies — no separate hand-declared
consumed set is needed. `produces` names entity kinds (types), never other
sources or namespaces, so ADR 0015 isolation is preserved: a source remains
mutually ignorant of every other source.

**2. Run order is a topological sort over the selected sources, derived from
those declarations.** For the set of sources selected by the run glob, source A
must precede source B when B's consumed set intersects A's `produces`. Among
sources with no ordering constraint between them, ties break by **descending
out-degree** (a source more others depend on runs earlier), then by source id —
fully deterministic, and it keeps foundational sources like `us-census-gazetteer`
at the front. The `us-census-gazetteer`-first behavior is thus an emergent
consequence (it is the sole producer of `LocationPaths`, which many sources
consume), not a special case. The hardcoded special case is removed.

**3. Direct FK targets suffice; transitivity is handled by the sort.** A source's
consumed set holds only the **direct** FK targets of its produced kinds, never
the transitive closure. Ordering on direct edges still guarantees full
transitive integrity, by induction over the FK graph: a producer of kind K
cannot create a K row without making K's own NOT-NULL FK targets resolvable — so
it either produces them too (same manifest) or consumes them (gaining its own
edge). A consumer of K therefore does not list K's FK targets; sorting it after
K's producer already guarantees they are present. Expanding a consumed set to
the closure would be redundant and would assert edges a source does not actually
have (e.g. a civil-case source has no direct FK to `Agency` — only to
`AgencyPersonnel`).

**4. Ordering constrains only the selected set; it never expands it.** Selecting
a consumer does not pull in its producers, and a consumed kind produced by no
selected source is **not** an ordering error. This preserves ADR 0015's core
guarantee: the 3-step resolver (current envelope → intake state → database)
means a producer that ran in any prior run already persisted its concept, so any
subset runs in any order across runs. Truly-absent resolve-or-fail references
still fail loud at runtime (ADR 0006), unchanged.

**5. Declarations are validated, fail-loud.** A cycle in the selected source
graph aborts the run and names the cycle. After a source runs, the kinds it
actually emitted must be a subset of its declared `produces`; an emitted kind
that was not declared aborts the run (declaration drift) — this is what keeps
`produces`, and therefore the derived consumed set, honest. Every `produces`
entry must be a real `ImportArtifactKind`.

## Consequences

- Run order is deterministic and explainable from data each source declares,
  replacing the census-first magic string. `intake run` can print the derived
  order and the edge that forced each precedence.
- Producers run before consumers within a run, so civil-case sources resolve
  against the rosters that ran earlier in the same run — coverage no longer
  depends on invocation order.
- Sources stay isolated: declarations reference entity kinds, not sources. No
  source names another source or namespace. ADR 0015 decisions 1–5 are unchanged.
- Across runs, the persisted-state guarantee is intact: any subset still runs in
  any order, relying on the 3-step resolver, because ordering never expands the
  selected set.
- A new source declares only `produces`. Its consumed set is derived from
  `FK_REFERENCES`, so it can never drift from the real FK graph. The emitted-kind
  drift check keeps `produces` honest — an undeclared emitted kind fails loud
  rather than silently skewing the derived consumed set and the order.
- ADR 0015's "single precondition" ordering statement is superseded by this
  derived order. ADR 0015 decisions 1–5 (isolation, self-containment,
  root-owned canonical identity, resolve-or-fail) are **not** changed.

## Alternatives Considered

- **Explicit `dependsOn: [sourceId]` per source** (source-to-source edges):
  rejected — it reintroduces the cross-source coupling ADR 0015 removed; a
  source would have to know another source's id.
- **Infer `produces` from a source's manifest at runtime**: rejected — the
  manifest is only known after `run()`, too late to order by, and it loses the
  drift check that keeps a source honest about what it emits.
- **Hand-declare `consumes` alongside `produces`** (guarded by a test that it is
  not narrower than the FK-derived set): rejected — if the set is derivable from
  `FK_REFERENCES`, declaring it by hand is redundant and adds a drift surface;
  derive it instead.
- **Expand the consumed set to the transitive FK closure**: rejected —
  redundant (the sort composes edges transitively, decision 3) and it asserts
  edges a source does not have.
- **A `consumesAlso` escape hatch for non-FK ("soft") dependencies**: rejected —
  every cross-entity reference in this system is a foreign key, so `FK_REFERENCES`
  is already the complete dependency set; resolution-by-name-match is how an FK is
  resolved, not a dependency without one. Adding the hook now is speculative
  surface that cannot be meaningfully validated. See the revisit trigger.
- **Keep the census-first special case and add one per new shared concept**:
  rejected — it does not scale and hides real constraints behind magic strings.
- **Auto-pull producers into the run set when a consumer is selected**:
  rejected — it re-runs producers the operator did not ask for and fights the
  persisted-state design; the 3-step resolver already covers prior runs.

## Revisit Trigger

Revisit if sources gain conditional production (a kind emitted only for some
inputs, making a static `produces` overbroad); if a real ordering constraint
appears that is **not** a foreign key (e.g. a source that must run after another
for a reason the FK graph cannot see) — that is the trigger to add an explicit
soft-dependency declaration, not before; or if cross-source dedup/merge (ADR 0015
revisit trigger) introduces ordering constraints the produced/consumed-kind graph
cannot express.
