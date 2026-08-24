# ADR 0022: Define AcquireDataContext Responsibilities

## Status

Proposed

> Peer of [ADR 0011](0011-define-data-context-responsibilities.md): that ADR
> defines the import-planning `DataContext` (the transform/load phase); this one
> defines the acquire-phase `AcquireDataContext` (the extract phase, ADR 0014).
> Both are narrow, read-only, injected facades over intake-owned data — never a
> source's private handle to the database.

## Context

A source's acquire phase (ADR 0014 "extract") downloads or scrapes raw inputs
for a later `intake run`. Some acquires must decide _what_ to download from data
intake already owns: `courtlistener` and `clearinghouse-api` search an external
API **once per agency**, so they need the agency roster — id, name, and location
context — to drive and scope their queries.

That roster lives only in the database (ADR 0015: sources are isolated; they
meet other sources' entities only through intake-owned state and the database,
never a shared in-memory context). An acquire must therefore read it. But a
source module must not hold a database handle: it would couple the source to the
schema, let it read across namespaces, and let it write. Acquire also runs
before any import in a run, so it reads _committed_ rows only — there is no
in-progress mutation state to consult, unlike import planning (ADR 0011).

We need a boundary that lets an acquire ask "which agencies, and where are they?"
without handing it the database.

## Decision

`AcquireDataContext` is a narrow, **read-only** query facade over
already-imported data, injected into a source's acquire by the `intake acquire`
composition root. A source's acquire receives it as `deps.data`; it never
constructs a database client, and it never issues SQL.

`AcquireDataContext` is responsible for:

- exposing typed, purpose-built read queries an acquire needs to decide what to
  download — today `agencies(query)`, returning agencies with their location
  context (state, county, place) and attached civil-case summaries, ordered by
  officer count and keyset-paginated on `(officer_count desc, id desc)`
- returning intake **canonical** entities (an agency's canonical `id`, name, and
  address row) so an acquire can stamp that id onto the raw records it writes —
  the acquire's output carries an exact id, resolved deterministically at the
  source, not a name to be re-resolved at import
- reading only **committed** database rows (acquire precedes import in a run;
  there is no in-progress mutation state to merge, and none is exposed)

The composition root (`intake acquire`) owns the lifecycle: it constructs the
one `DatabaseClient` from `DATABASE_URL`, builds `AcquireDataContext` over it,
injects it into every matched source's acquire, and closes the client. When
`DATABASE_URL` is absent, the injected `agencies()` **fails loud** on first call
rather than returning empty — an acquire that needs the roster must not silently
download nothing.

`AcquireDataContext` must not:

- expose a database client, connection string, or raw query interface to a
  source
- allow any write, DDL, or mutation
- read or resolve another source's namespace-local names or ids (ADR 0015) —
  it returns intake-root canonical entities only
- expose in-progress or uncommitted planning state (that belongs to the import
  `DataContext`, ADR 0011)
- silently return empty on a misconfiguration (missing `DATABASE_URL`); it fails
  loud

The interface is a deliberately small set of named queries, extended by adding a
focused method for a concrete acquire need — never widened into a general query
runner or a service locator (mirroring ADR 0011's stance for the import context).

## Consequences

- An acquire decides what to download from intake-owned canonical data without
  touching the database or knowing the schema; tests inject a fake
  `AcquireDataContext` with no database.
- Because the facade returns canonical ids, an agency-driven acquire
  (`courtlistener`, `clearinghouse-api`) stamps the exact `agency_id` onto each
  raw record it writes, so the later import links by id with **no name-based
  agency resolution** — the acquire, not the import, fixes agency identity.
- Cross-source coupling stays out: an acquire reads canonical agencies, not
  another source's namespace (ADR 0015). Sources remain isolated and runnable in
  dependency order (ADR 0021).
- Read-only, committed-rows-only keeps acquire safe to re-run and free of the
  mutation-planning concerns that belong to the import `DataContext` (ADR 0011).
- A new acquire-time query means a new typed method on `AcquireDataContext`
  backed by a narrow read adapter, not a broadened surface.

## Alternatives Considered

- Give the acquire the `DatabaseClient` directly: rejected — couples sources to
  the schema, permits writes and cross-namespace reads, and breaks the source
  isolation boundary.
- Resolve agencies by name at import instead of stamping ids at acquire:
  rejected — name resolution is lossy and non-deterministic; the acquire already
  knows exactly which canonical agency it is querying for, so it fixes the id
  there (see the "no fallbacks / resolve by id only" rule this enables).
- Reuse the import `DataContext` (ADR 0011) for acquire: rejected — that context
  owns canonical-id _assignment_, in-progress mutation state, and resolver
  caches for planning; acquire needs none of it and must not create or mutate.

## Revisit Trigger

Revisit when an acquire needs a read that is not an agency query (add a typed
method), when acquire must page over another entity, or if an acquire ever needs
uncommitted planning state (which would signal acquire and import are being
conflated and should stay separate).
