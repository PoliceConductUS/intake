# ADR 0015: Isolate Namespaces and Own Cross-Source Identity at the Root

## Status

Accepted

## Context

Multiple source namespaces (`us-census-gazetteer`, `gov.tx.tcole`,
`gov.azpost.roster`, `mn-post`, …) each produce artifacts about overlapping
real-world entities — the same agency, officer, or licensing authority may be
described by more than one source.

ADR 0008 established that intake resolves canonical IDs from
`namespace + kind + source-name` and owns the mapping ledger. ADR 0006
established that artifacts may create known-valid related entities, and that
`location_path` links must resolve to an existing `location_path`/alias row.

This ADR clarifies how those decisions compose when sources overlap, and how a
source refers to a shared concept it does not own. It reverts nothing in ADR
0006 or ADR 0008; it makes their interaction explicit.

## Decision

**1. Source namespaces are isolated and mutually ignorant.** A source knows only
its own namespace-local source names. It never knows, references, or depends on
another namespace's names, canonical IDs, or entities. Source-produced artifacts
contain no cross-namespace references.

**2. Sources are self-contained.** A source emits every entity it needs using its
own namespace-local source names — including entities that are, in reality,
shared across sources. A source that processes a licensing authority's data
emits that authority within its own namespace (the `gov.tx.tcole` source emits
TCOLE; a `gov.azpost.roster` source emits AZ POST). There is no shared or curated
cross-source entity dataset that other sources reference.

**3. Only the intake root knows canonical IDs.** Per ADR 0008, canonicalization —
mapping `namespace + kind + source-name` → canonical id, find-or-create,
order-independent — happens only at the intake root and is intake-owned.
Namespace-local IDs are meaningless outside their namespace.

**4. Cross-source identity is unified at the root, never by a source.** When two
isolated namespaces emit the same real-world entity (e.g. a future roster source
and `gov.tx.tcole` both emit TCOLE), collapsing them to one canonical entity is a
root-level dedup/merge decision (ADR 0008's duplicate/merge handling), driven by
natural keys, aliases, and provenance. Until that unification exists, each
source's entity is its own canonical row, and the database's licensing
authorities are exactly those emitted by the imported sources.

**5. Shared canonical concepts are resolved by the backend facade from
source-local values.** A source refers to a shared concept — notably a
`location_path` — by emitting a namespace-local value it actually knows (e.g. a
state, `"tx"`), never a canonical id and never another namespace's name.

The "backend" is the intake-root planning facade — `DataContext` (ADR 0011) —
the single point through which every database mutation and every canonical
resolution flows. It maps the source-local value to a canonical id via the same
**3-step property resolution** ADR 0011 defines for every property-derived id:
the target must

1. have already been planned in the **current command's `DatabaseMutations`**
   envelope (e.g. a `location_path` the running source itself emitted), or
2. exist in **intake-owned state**, or
3. exist in the **database**.

If none of the three resolve it, the import fails loud (resolve-or-fail, ADR
0006). "**Resolvable by the backend**" therefore spans all three steps — it does
**not** mean "written to the database." Isolation is preserved because the facade
resolves only against intake-owned canonical state and the database it owns; it
**never** reads a source's namespace (not even the source that produced the
concept). The source never emits or resolves a canonical id.

## Consequences

- Sources can be authored, run, and reset in any order with no cross-source
  coordination.
- Overlapping entities across sources yield duplicates until root dedup/merge is
  implemented; this is accepted and currently bounded (one authority per POST
  source — TCOLE, AZ POST, MN POST).
- A curated shared-authority dataset is unnecessary and is not built. Introducing
  one later is just another source, plus root dedup.
- `location_path` links from any entity kind must be **resolvable by the backend**
  (planned in the current envelope, in intake-owned state, or in the database);
  if the backend can resolve none of the three, the import fails loud (ADR 0006)
  rather than inventing a location in-source. "Resolvable by the backend" is the
  precondition, not "written to the database."
- Run ordering follows from that single precondition, not from source-to-source
  dependencies: the only cross-source constraint is that the source producing a
  shared concept (us-census-gazetteer → `location_path`) must run first so those
  paths are resolvable by the backend; every other source then runs in any order.

## Alternatives Considered

- A shared licensing-authorities source that other sources reference by
  cross-namespace key: rejected — it requires a source to know another
  namespace's names/ids, violating isolation.
- Sources emitting canonical `location_path` ids directly: rejected — sources do
  not know canonical ids (ADR 0008); only the root maps location values.

## Revisit Trigger

Revisit when cross-source dedup/merge is implemented (ADR 0008 merge workflows),
or when a shared reference dataset (e.g. the full US POST authority roster) is
introduced as its own source.
