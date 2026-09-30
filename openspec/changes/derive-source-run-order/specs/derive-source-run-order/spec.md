## ADDED Requirements

### Requirement: Sources Declare Produced Kinds; Consumed Kinds Are Derived

A source module MUST export `produces`, a list of `ImportArtifactKind` values —
the kinds the source emits in its manifest — and MUST NOT hand-declare its
consumed set. The runtime MUST derive the source's consumed set as the
foreign-key targets of its produced kinds (per `FK_REFERENCES`) minus its
produced kinds. Every `produces` entry MUST be a member of
`IMPORT_ARTIFACT_KINDS`; the runtime MUST fail at source load otherwise.
`produces` MUST name entity kinds only — never another source or namespace.

#### Scenario: Source declares produced kinds and its consumed set is derived

- **WHEN** a source exports `produces = ["CivilCases", "CivilCaseOfficers", "CivilCaseLinks"]`
- **THEN** the runtime derives its consumed set from `FK_REFERENCES` as `["LocationPaths", "AgencyPersonnel"]` (the direct FK targets not in `produces`) and uses it to order the run

#### Scenario: Consumed set holds only direct FK targets, not the transitive closure

- **WHEN** a source produces `CivilCaseOfficers`, whose only officer FK targets `AgencyPersonnel`
- **THEN** the derived consumed set includes `AgencyPersonnel` but not `Agency` or `Personnel` (which are FK targets of `AgencyPersonnel`, resolved transitively by the sort)

#### Scenario: Unknown kind in produces fails at load

- **WHEN** a source declares a `produces` entry that is not an `ImportArtifactKind`
- **THEN** the runtime fails before running any source

### Requirement: Derived Deterministic Multi-Source Run Order

When `intake run` selects more than one source, the runtime MUST compute the run
order by topologically sorting the selected sources over the entity-kind graph
their declarations imply: source A MUST precede source B when B's `consumes`
intersects A's `produces`. Sources with no ordering constraint between them MUST
be ordered by a stable, deterministic tiebreak: descending out-degree in the
source graph, then source id. The runtime MUST NOT rely on a hardcoded
per-source ordering special case. The same selected set MUST always yield the
same order.

#### Scenario: Producer precedes its consumers

- **WHEN** a run selects `us-census-gazetteer` (produces `LocationPaths`) and `gov.tx.tcole` (consumes `LocationPaths`)
- **THEN** `us-census-gazetteer` runs before `gov.tx.tcole`

#### Scenario: Civil-case sources run after the rosters that supply officers

- **WHEN** a run selects `gov.tx.tcole` / `mn-post` (produce `AgencyPersonnel`) and `courtlistener` / `clearinghouse-api` (consume `AgencyPersonnel`)
- **THEN** both roster sources run before both civil-case sources

#### Scenario: Order is stable and independent of glob match order

- **WHEN** the same set of sources is selected on two runs
- **THEN** the derived order is identical

### Requirement: Ordering Constrains Only the Selected Set

The runtime MUST sort only the sources selected by the run glob. Selecting a
consumer MUST NOT add its producers to the run set. A kind that a selected source
consumes but no selected source produces MUST NOT be treated as an ordering
error; the runtime relies on the 3-step resolver (current envelope → intake
state → database) for such references, and a genuinely unresolvable
resolve-or-fail reference still fails at import time (unchanged).

#### Scenario: A consumer runs alone against persisted state

- **WHEN** an operator runs `intake run courtlistener` and no roster source is selected
- **THEN** the runtime runs `courtlistener` and does not add a roster source, resolving officers from intake state / the database

#### Scenario: Unproduced consumed kind is not an ordering error

- **WHEN** a selected source consumes a kind no selected source produces
- **THEN** the run proceeds in derived order without aborting on that basis

### Requirement: Fail-Loud Ordering and Drift Validation

The runtime MUST abort a multi-source run when the selected source graph contains
a cycle, reporting the sources in the cycle and the consumed kind on each edge.
After a source's `run` returns, the runtime MUST assert that every kind the
source emitted is declared in its `produces`; an emitted-but-undeclared kind MUST
abort the run.

#### Scenario: Dependency cycle aborts the run

- **WHEN** the selected sources form a cycle (A consumes a kind B produces and B consumes a kind A produces)
- **THEN** the runtime aborts before running and names the cycle and the kinds on its edges

#### Scenario: Emitting an undeclared kind aborts the run

- **WHEN** a source's `run` emits a kind not listed in its `produces`
- **THEN** the runtime aborts the run and reports the undeclared kind and source

### Requirement: Run Order Is Explainable

At the start of a multi-source run, the runtime MUST log the derived run order
and, for each precedence, the consumed kind and producing source that forced it.

#### Scenario: The derived order is logged before sources run

- **WHEN** a multi-source `intake run` begins
- **THEN** the runtime logs the derived order and, for each source placed after another, the consumed kind and producing source that forced the precedence

## MODIFIED Requirements

### Requirement: Source Module Contract

A source's module under `sources/<source-id>/` MUST export a deterministic `run`
function (as previously specified) and MUST additionally export a `produces`
declaration as specified in "Sources Declare Produced Kinds; Consumed Kinds Are
Derived". The runtime MUST fail before running when the module does not export
`run` or `produces`, or when its `produces` declaration is invalid.

#### Scenario: Missing produces fails early

- **WHEN** a source module exports `run` but omits `produces`
- **THEN** the runtime fails before invoking `run` or writing any database rows
