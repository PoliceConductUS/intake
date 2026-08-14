# ADR 0011: Define DataContext Responsibilities

## Status

Proposed

> Referenced by [ADR 0015](0015-isolate-namespaces-and-own-cross-source-identity-at-root.md):
> `DataContext` is "the backend" through which isolated sources' namespace-local
> reference values resolve to canonical ids, via the 3-step property resolution
> below (current envelope / intake-owned state / database) — never by reading a
> source's namespace.
>
> Superseded in part by [ADR 0016](0016-resolve-entity-properties-with-composable-resolvers.md):
> `canonicalIdFromProperty` and `canonicalIdFor` are replaced by one general
> `resolveProperty(facade, property)` dispatch over composable per-property
> resolvers (find-or-create, resolve-or-fail, generate-unique, derived, constant).
>
> Framed by [ADR 0017](0017-intake-persistence-is-a-bespoke-orm.md): `DataContext`
> is the ORM's Unit of Work + Identity Map (the mutation-*builder*); the
> transaction/IO/aggregate-reporting live in a thin flush script, not here.

## Context

Import planning needs a shared execution context after source artifacts have
been validated and before database mutations are written to the replayable
mutation ledger or submitted to the database.

That context has to coordinate cross-record behavior such as source identity
resolution, canonical ID assignment, database reads, command-local and
cross-command caches, current in-progress database mutations, foreign-key
resolution, location path lookup, derived-field resolution, and validation.
Without a clear boundary, it can easily become a catch-all for envelope IO,
database writing, source-specific policy, and replay execution.

The architectural analogy is a compiler. Source `Artifacts` are the input
program. `DataContext` is the compile context: symbol table, durable cache
coordinator, database read facade, and database mutation builder.
`DatabaseMutations.spec.mutations` is the intermediate representation. Replay
or execution applies that intermediate representation to the database and emits
`DatabaseMutationResults`.

## Decision

`DataContext` is the import-planning context for one command execution. It is
created after source artifacts have been read, artifact-level manual mutations
have been applied, and the command has loaded the intake-owned state needed for
stable planning.

`DataContext` is responsible for:

- owning source identity to canonical ID resolution through
  `SourceNameToCanonicalId`
- assigning new canonical IDs through durable intake-owned state before
  mutation emission
- owning reusable caches needed for stable imports, including resolver outputs
  persisted as `ResolvedProperty`
- exposing `fromSource(apiVersion, namespace, kind, name)` to return a typed
  record facade for the requested source object
- exposing `canonicalIdFor(apiVersion, namespace, kind, name)` for processors
  that need to link to a previously defined source object
- exposing `canonicalIdFromProperty({ source, property })` for processors that
  need the canonical ID of the target object referenced by one source property
- reading current database rows through narrow database read adapters
- maintaining the current in-progress `DatabaseMutations` envelope
- resolving foreign keys against either current database rows or previously
  planned mutations in the same command
- preserving database dependency order by requiring depended-on source objects
  to be planned before they are referenced
- exposing focused planning capabilities, such as location path lookup and
  resolver cache access
- emitting planning diagnostics through injected logging

The record facade returned by `fromSource(...)` gives callers the same public API
whether the underlying record will be read, created, or updated. Internally it
tracks the current database state, the desired state, and the backing mutation.
If a caller sets a field to the same value already present in the database,
that is not a database mutation, but it is still meaningful replay state. The
facade records an expected-state check so replay refuses to continue if that
field no longer has the planned value. If a caller sets a field to a different
value, the facade records an update operation with the expected prior value. If
the row does not exist, the facade records create state.

The source facade may be complete or incomplete when a processor passes source
data to it. Completeness is determined by `DataContext` and the facade, not by
the processor. Processors express only source intent. For example, an `Agency`
processor receives an `Agency` artifact record, asks `DataContext` for the
matching `Agency` facade, calls `agency.merge(sourceAgencySpec)`, and then
returns. The processor does not choose create versus update, does not compare
against the database, does not build `AgencyCreate` or `AgencyUpdate`, and does
not know the `from` value for update operations.

`DataContext` holds a reference to every facade it returns. Repeated
`fromSource(...)` calls for the same source identity return the same facade.
The current planning state is the merge of committed database rows and the
desired state already recorded on facades in this command. This lets later
facades link to records that do not exist in the database yet but are already
represented by earlier facades.

The command asks `DataContext` to collect mutations after artifact processing.
Each touched facade exposes `toMutation()`, which converts source intent plus
current database state into an exact database mutation envelope or invalid
mutation diagnostic. During `toMutation()`, `DataContext` and the facade
resolve source identity, canonical IDs, foreign-key properties,
resolver-backed required fields, reusable `ResolvedProperty` cache entries, and
current database state. Replay never performs these resolutions.

Create and update have different mutation shapes. If no canonical database
record exists, `toMutation()` emits an entity-specific `*Create` envelope whose
`spec` is the complete record to insert. A create envelope does not contain
per-property operations because create means "insert this complete record." If a
canonical database record does exist, `toMutation()` emits an entity-specific
`*Update` envelope whose `spec.operations` is an ordered list of property checks
and sets. Every update `set` operation records `from` and `to`; every
same-value assignment records a `check` operation with the expected value. If
create-required fields cannot be resolved, `toMutation()` must not emit a partial
create.

`canonicalIdFor(...)` is an undefined-symbol check. It may return a canonical ID
for an existing database row or for a create mutation already planned in the
current `DatabaseMutations` envelope. If the source object has not been resolved
or reserved yet, `canonicalIdFor(...)` must fail loudly. This is how processors
such as `AgencyPersonnel` link to agencies that do not exist in the database
yet but have already been defined earlier in the current source artifact set.

`canonicalIdFromProperty({ source, property })` resolves a foreign-key-like
source property on a typed source facade. The `source` facade owns `apiVersion`,
`metadata.namespace`, `kind`, and `metadata.name`; callers must not pass those
identity fields separately. `DataContext` owns the mapping from source
`kind + property` to the target kind and resolver input. For example, an
`Agency` source facade plus `location_path_id` resolves the target
`LocationPath` canonical ID from the agency address fields. The caller does not
pass `targetKind` because `DataContext` already knows the target kind for that
source property.

For property-derived IDs, `DataContext` must validate that the target canonical
ID either exists in the database, exists in intake-owned state, or has already
been planned in the current `DatabaseMutations` envelope. Resolvers used by
`canonicalIdFromProperty(...)` must be pure and cacheable. The durable cache key
uses the source facade identity, the property name, and a stable fingerprint of
the typed resolver input derived by `DataContext`.

`DataContext` must not:

- read or write YAML envelopes directly
- parse source-produced `Artifacts`
- apply `ArtifactMutations` or `ArtifactMutation` envelopes
- own source-module behavior
- execute database mutations against the database
- serialize `DatabaseMutations`
- write `DatabaseMutationResults`
- silently recover from malformed or incomplete planning state

`DataContext` may create or reserve new canonical IDs only by writing the
durable state that makes those IDs stable across imports. It must never rely on
database-generated IDs or transient in-memory IDs for durable records.

Database access inside `DataContext` is read-only. Reads are allowed only for
planning-time facts needed to decide whether a row is read, created, or updated
and to validate links. Database mutation execution remains in a separate
executor that consumes `DatabaseMutations`.

All reusable import state belongs to `DataContext` during planning. The command
constructs `DataContext` with the state adapters it is allowed to use, and
`DataContext` persists only the state it owns through those adapters. Resolver
adapters used by import planning must be pure and cacheable for their full typed
cache key.

## Consequences

- Import planning has one place for cross-record coordination without mixing in
  envelope IO or replay execution.
- Tests can construct `DataContext` with fake database read adapters, fake
  state adapters, fake resolvers, and an in-memory `DatabaseMutations` envelope.
- SourceNameToCanonicalId assignment, resolver caches, and
  current planned mutations are coordinated consistently.
- Replay remains deterministic because `DataContext` emits an ordered
  `DatabaseMutations` ledger before database execution.
- Adding new planning domains should mean adding focused methods or typed
  facades on `DataContext`, not expanding it into an all-purpose service
  locator.

## Alternatives Considered

- Put planning behavior directly in the database CRU code: rejected because it
  mixes source compilation, mutation planning, and database execution.
- Put preparation behavior in source modules: rejected because canonical
  database preparation is owned by intake, not producers.
- Let `DataContext` own envelope IO or database execution: rejected because it
  would blur planning, persistence, and replay boundaries.

## Revisit Trigger

Revisit when import planning needs multiple independent contexts, when mutation
planning state must be serialized independently of `DatabaseMutations`, or when
source modules need a separate public planning SDK.
