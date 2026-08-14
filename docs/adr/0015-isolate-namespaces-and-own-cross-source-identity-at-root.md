# ADR 0015: Isolate Namespaces and Own Cross-Source Identity at the Root

## Status

Proposed

## Context

Multiple source namespaces (`census-gazetteer`, `gov.tx.tcole`,
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

**5. Shared canonical concepts are resolved by the root from source-local
values.** A source refers to a shared concept — notably a `location_path` — by
emitting a namespace-local value it actually knows (e.g. a state, `"tx"`), never
a canonical id and never another namespace's name. The intake root maps that
value to an existing canonical `location_path` (resolve-or-fail, per ADR 0006).
The source never emits or resolves the canonical `location_path` id.

## Consequences

- Sources can be authored, run, and reset in any order with no cross-source
  coordination.
- Overlapping entities across sources yield duplicates until root dedup/merge is
  implemented; this is accepted and currently bounded (one authority per POST
  source — TCOLE, AZ POST, MN POST).
- A curated shared-authority dataset is unnecessary and is not built. Introducing
  one later is just another source, plus root dedup.
- `location_path` links from any entity kind require an existing
  `location_path`/alias row; missing ones fail the import (ADR 0006) rather than
  being invented in-source.

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
