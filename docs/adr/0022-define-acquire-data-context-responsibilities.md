# ADR 0022: Define AcquireDataContext Responsibilities

## Status

Accepted

> Peer of [ADR 0011](0011-define-data-context-responsibilities.md): that ADR
> defines the import-planning `DataContext` (the transform/load phase); this one
> defines the acquire-phase `AcquireDataContext` (the extract phase, ADR 0014).
> Both are narrow, read-only, injected facades over intake-owned data — never a
> source's private handle to the database.
>
> **Terminology:** per [ADR 0036](0036-rename-the-produce-phase-from-run-to-transform.md)
> the "acquire/run split" here is the **acquire/transform split** — the produce phase
> is `transform`. The responsibilities are unchanged.

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
- returning entities with a **namespace-local source id, never a canonical id**
  (ADR 0023): an acquire stamps that source id onto the raw records it writes,
  and the import resolves it to canonical through the ordinary resolver path — an
  exact, ledger-backed id, not a name to be re-resolved at import, and not a
  canonical id leaked into a source's output (ADR 0015)
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
- read or resolve another source's namespace-local names or ids (ADR 0015), or
  return a canonical id to a source — it returns the calling namespace's own
  source ids (ADR 0023)
- expose in-progress or uncommitted planning state (that belongs to the import
  `DataContext`, ADR 0011)
- silently return empty on a misconfiguration (missing `DATABASE_URL`); it fails
  loud

The interface is a deliberately small set of named queries, extended by adding a
focused method for a concrete acquire need — never widened into a general query
runner or a service locator (mirroring ADR 0011's stance for the import context).

### The default API-source shape: search by agency in acquire, resolve in run

An API source's **default** shape is: **acquire searches the external API once
per agency** — driving its queries from `agencies(query)` and stamping each raw
record with that agency's namespace-local source id — and **`run` then resolves
one or more officers (and any other artifacts) at that known agency** through the
intake-owned run context (`resolvePersonnel`, ADR 0023) to decide which artifacts
are created. `courtlistener`, `clearinghouse-api`, and `youtube.policeactivity`
all follow it.

This is the default because it puts agency identity where it is exact and cheap —
the acquire fixes it as a ledger-backed source id, so `run` never resolves an
agency from free text and never guesses one; the only fuzzy step left is
officer/case resolution, which is gated inside an intake-owned context. It also
keeps sources isolated (ADR 0015) and runnable in dependency order (ADR 0021).

A source **may** deviate — a bulk-file source that already carries agency and
officer identity, or a source whose data has no per-agency search axis, is not
forced through a per-agency search. But deviation is **explicit and justified**:
a source that does not follow this default MUST state, in its source config or
OpenSpec change, why the per-agency-search-then-resolve path is not appropriate
for it. The default is the presumption; departing from it silently is not allowed.

## Consequences

- An acquire decides what to download from intake-owned canonical data without
  touching the database or knowing the schema; tests inject a fake
  `AcquireDataContext` with no database.
- Because the facade returns a namespace-local source id (ADR 0023), an
  agency-driven acquire (`courtlistener`, `clearinghouse-api`) stamps that exact
  `agency_id` onto each raw record it writes, so the later import links by
  resolving that source id with **no name-based agency resolution** — the
  acquire fixes agency identity, and no canonical id ever enters a source's
  output.
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
  knows exactly which agency it is querying for, so it fixes identity there via a
  namespace-local source id (ADR 0023), enabling the "no fallbacks / resolve by
  id only" rule.
- Return the agency's canonical id for the acquire to stamp (this ADR's original
  decision): rejected — it leaks canonical identity into a source's output,
  breaking ADR 0015; the acquire returns a namespace-local source id instead
  (ADR 0023).
- Reuse the import `DataContext` (ADR 0011) for acquire: rejected — that context
  owns canonical-id _assignment_, in-progress mutation state, and resolver
  caches for planning; acquire needs none of it and must not create or mutate.

## Revisit Trigger

Revisit when an acquire needs a read that is not an agency query (add a typed
method), when acquire must page over another entity, or if an acquire ever needs
uncommitted planning state (which would signal acquire and import are being
conflated and should stay separate).
