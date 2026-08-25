# ADR 0026: Entity Facades Are Configuration Over One Engine

## Status

Proposed

> Builds on ADR 0016 (composable per-property resolvers), ADR 0019 (no startup
> reads; the property cache), and ADR 0025 (generated database-bound models).

## Context

Each persisted entity was resolved by its own facade: a hand-written class (or a
per-entity factory module) that listed the entity's columns, wired a resolver to
every field, named its create/update mutation constructors, and — for the
geocoded entities — subclassed a caching base while the rest subclassed a
non-caching one. Eighteen kinds meant eighteen near-identical descriptions of
"resolve id, resolve the foreign keys, pass the rest through, then plan a
create-or-update," each a place for the column set to drift from the schema and
each restating boilerplate the schema already knows.

Two facade engines also coexisted: a cache-aware `ResolvingFacade` (used only by
Agency) and a near-verbatim copy without the cache (`EntityFacade`, used by the
simple kinds). The same memoization, circular-dependency guard, and pass-through
logic lived in both.

Almost everything a facade needs is already generated from the database:
`FK_REFERENCES` (each kind's foreign keys and their targets), `RESOLVED_PROPERTIES`
(the cache-backed fields), the per-kind `*CreateSpec` (whose object shape is the
exact column set), and the `{Kind}{Create,Update,Read}` mutation constructors
(one uniform set per kind). What is *not* derivable is small: which column is the
identity, whether an existing row is diffed or read, and the handful of columns
whose resolver is not a plain foreign-key find or pass-through (casing, slug,
geocode, a state-path lookup, a cross-source ledger reference).

## Decision

**There is one facade engine, and a kind is configuration, not a class.**

- **One engine.** `EntityFacade` is the single resolution engine: memoized
  `value`/`raw`, circular-dependency detection, plain source-or-null pass-through
  for unmanaged columns, the `source > cache > live-resolve` property cache
  (folded in from the former `ResolvingFacade`), and create-vs-(update|read)
  mutation planning generalized over the identity column. No entity subclasses
  it.

- **A generic builder assembles each kind from generated data.** `buildFacadeForKind`
  derives the column set from the kind's `*CreateSpec` shape, its mutation
  constructors by the `{Kind}{Operation}` naming convention, its identity resolver
  (a minted canonical id) and one find per `FK_REFERENCES` entry, and its
  cacheable properties from `RESOLVED_PROPERTIES`. Every other column passes
  through.

- **A small registry holds only the exceptions.** `RESOLVER_OVERRIDES` names, per
  kind, just what is not derivable: a non-`id` identity or a natural-key identity,
  read-vs-update upsert, columns omitted when null, and per-column resolver
  overrides (a state → location-path lookup, a cross-source ledger foreign key, a
  nullable foreign key, name/title casing, slug or geocode resolution). A kind
  with no exceptions has no registry entry.

- **The DataContext maps records through the engine.** It no longer describes any
  entity's fields; it supplies the injected backend and calls the builder.
  `toMutation` is not a facade-specific method the DataContext knows per kind —
  it is the one engine method the mutation loop maps over the resolved records.

## Consequences

- Adding or changing a persisted column is a schema change plus a regenerate; no
  facade edit is required unless the new column needs a non-default resolver, in
  which case exactly one override line is added.
- The column set, foreign keys, mutations, and cache membership can no longer
  drift from the schema — they are read from generated data at build time.
- The two engines become one, removing the duplicated resolution core.
- Reviews reject a new per-entity facade class or a hand-listed column set; the
  fix is a registry entry (or nothing, when the kind is fully generic).

## Alternatives Considered

- **A thin factory module per kind (the interim form):** rejected as the end
  state — eighteen near-identical files still restate columns and mutations that
  the generator already knows, and still drift.
- **Encoding foreign-key nullability in `FK_REFERENCES`:** rejected — a column's
  nullability already lives in its generated spec, and a foreign key that must
  point somewhere is `NOT NULL` in the database. Driving off database nullability
  also silently relaxed a column that intake intends to require; the two genuinely
  optional foreign keys are the only overrides.

## Revisit Trigger

Revisit if a kind needs resolution the engine cannot express as configuration
(extend the engine and the config, not a subclass), or if the generated data
proves insufficient to derive columns/mutations for some persisted kind.
