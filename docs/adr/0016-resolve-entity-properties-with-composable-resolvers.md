> # ADR 0016: Resolve Entity Properties with Composable Per-Property Resolvers

## Status

Proposed

> Framed by [ADR 0017](0017-intake-persistence-is-a-bespoke-orm.md): these
> per-property resolvers are the ORM's Lazy Load + Foreign-Key Mapping; facades
> are Data Mappers; the ledger is the Identity Map's durable half.

## Context

Before a source record becomes a database mutation, several of its properties
must be derived from source-local values: the entity's own canonical id, foreign
keys, derived values (coordinates, slugs), and constants.

Today this is scattered across three mechanisms:

- `SourceNameToCanonicalId` assignment (ADR 0008) — the entity's own canonical id.
- The `ResolvedProperty` durable cache + `agency-field-resolution` — slugs,
  `location_path_id`, coordinates.
- `DataContext.canonicalIdFromProperty` / `canonicalIdFor` (ADR 0011) — a single
  hardcoded `Agency.location_path_id` case, exercised only by a test and **not
  wired into production**.

This ADR unifies property resolution into one mechanism. It revises ADR 0008 (it
collapses the narrow canonical-id ledger into one cache) and supersedes the
`canonicalIdFromProperty` / `canonicalIdFor` interface in ADR 0011.

## Decision

**1. Every entity is mutated through its async `DataContext` facade — no
exceptions.** There is no transform-row or other non-facade mutation path; a
source record becomes a database mutation only by going through
`DataContext.fromSource(...)` → the entity's async facade → `toMutation()` (ADR
0011). Every property that must be derived before a DB write is produced by a
**resolver** — a pure, entity-agnostic, reusable unit given the source facade plus
injected backend capabilities (geocoding, location-path lookup, the durable
cache), attached per `(entity, property)` on that facade.

**2. Resolvers compose via lazy, memoized property promises.** The facade exposes
each resolvable property as a memoized promise. A resolver that needs another
property `await`s that property's promise, which triggers its resolution on
demand. Composition (address → lat/lng → containing `location_path`) and ordering
both fall out of the `await` graph — there is no separate ordering pass.
Resolution runs when a consumer (`toMutation`) awaits the columns it writes, so
call order is resolution order; every resolvable property is thus resolved before
or as part of writing the database mutations. **Property access is uniformly async
and generically typed** — one accessor `value<K extends keyof Row>(property: K):
Promise<Row[K]>` keyed by the entity's row type, so each property's promise
carries its own target-column type (`location_path_id` → `string`, `latitude` →
`number`). A resolver is therefore `Resolver<T>`, attached per property, returning
a `Promise<T>` of its column's type (async, since it may await other properties);
a plain source value returns an already-resolved promise and a resolved property
runs its resolver. A consumer awaits every column it writes
without distinguishing plain from resolved, and TypeScript enforces both the await
and the type (a `Promise<T>` cannot land in a column un-awaited or mistyped). Circular property dependencies are unsupported; a per-facade
"in-progress" guard turns a would-be deadlock into a loud error.

**3. Each resolver carries exactly one unresolved-policy: a default value OR an
exception — never both.** Resolves → return the value. Otherwise: throw the
configured exception, or return the configured default. If neither was
configured, throw. Every such failure is **fast and loud**, and its message
carries enough context to locate the record in the source data precisely —
source-namespace, kind, source-id, the property, and the offending value. There
is no silent skip (records intentionally excluded are handled earlier, out of
band).

**4. Every find/lookup consults the three resolution levels, in order:** (1)
mutations planned earlier in the current command, (2) intake-owned state (the
durable cache), (3) the database. **The database read is the last step and is how
existing records are preserved** — find-or-create reuses an existing row's id
instead of minting a duplicate, and a uniqueness check (slug) sees rows already
in the database. The property kinds and their resolvers:

- **Canonical id** (the entity's own id): the resolver is given
  `(source-namespace, source-id, natural-key, default-or-exception)`. Find in
  order: exact by `(namespace, kind, source-id)` in the cache; else a
  **natural-key match against the database** — this is how a record already in the
  DB but not yet in the cache is preserved (its existing id is *recovered*, not
  duplicated); else mint a new `cuid2` and persist. An ambiguous natural-key match
  fails fast and loud. (ADR 0008's assignment, now the "id" property's resolver.)
- **Foreign key to another entity (same source):** because a source emits no
  forward references (#9), the target was already emitted, so this is a **find** —
  locate the target's facade by `(target kind, namespace, target source-id)` and
  `await` its id (which the target's own id resolver produced). A missing target
  is a forward-reference violation and **fails fast and loud** — never a
  minted stub.
- **`location_path_id` — the one FK exception:** **resolve-or-fail** via a backend
  query (state → path-match, or address → contains-point, both with alias
  handling). Never minted (ADR 0006); the source only supplies a namespace-local
  value and the root resolver reaches the backend (ADR 0015).
- **Generated value:** e.g. a unique slug — resolve, else generate a value whose
  uniqueness is checked across all three resolution levels (below): entities
  planned earlier in the current command, intake-owned state, and existing
  database rows.
- **Derived value:** e.g. coordinates — a composition (address → lat/lng, cached
  under a normalized-address key; then lat/lng → containing `location_path`).
- **Constant:** a fixed value.

**5. One durable resolver cache.** All resolutions are cached in a single durable,
on-disk (yaml) store owned by the intake root, under `$INTAKE_WORKSPACE/intake/`.
A resolution's key is its stable identity: for an entity property,
`(namespace, kind, source-id, property)`; for a reusable sub-computation (e.g.
geocoding), the resolver's own normalized input fingerprint (the normalized
address), so the same address resolves once across records. The physical file
layout is an intake implementation detail. This collapses today's separate
`SourceNameToCanonicalId` ledger and `ResolvedProperty` cache into one. The
per-facade promise memoization is transient in-command computation over this cache
— not a separate store; **there is no in-memory-only store.** Per-property
stability still differs and is honored: a minted canonical id is write-once and
stable; a derived value (geocode) is recomputable and keyed by its normalized
input fingerprint, so the same address resolves once across records.
**Invalidation is manual** — delete the cache file(s). The next resolution
recomputes a derived value, or re-finds an identity by source-id/natural-key
(recovering the existing id from the database, so a delete does not create a
duplicate). There is no automatic staleness detection.

**6. Boundary with the mutation layer.** Resolvers produce desired *values* only.
The facade's `toMutation` still owns create-vs-update diffing (check vs set); a
resolver never decides create/update or reads current DB rows for that purpose
(ADR 0011).

**7. Supersedes `canonicalIdFromProperty` / `canonicalIdFor`.** Both become the
one general dispatch — `resolveProperty(facade, property)` — that looks up the
property's attached resolver and runs it. The former FK cases are resolvers with
find-or-create (or must-exist) policies.

**8. Adoption is incremental.** `LicensingAuthority` is built on this mechanism
first (greenfield) to prove it. Once that works, every other entity migrates to
resolvers and the old mechanisms — `SourceNameToCanonicalId`, `ResolvedProperty`,
`agency-field-resolution`, and the non-facade licensing path — are retired and
their stores collapsed into the one cache. Until then the old and new mechanisms
coexist; the "supersedes/revises" above describes the end state, not a big-bang cut.

**9. Source records carry no forward references.** A source MUST emit a referenced
entity before any record that references it (dependency order). Because the target
is therefore already emitted, a same-source FK is a plain **find** (decision #4);
a reference to a not-yet-emitted target is a violation that fails fast and loud.
This removes forward-reference / create-a-stub handling entirely. It applies to
same-source references only — cross-source references (e.g. `location_path_id`,
owned by another source) are resolve-or-fail against the backend, since a source
cannot order another source's records.

**10. Batched (DataLoader) resolvers — N+1 avoidance, emergent from concurrency.**
A resolver whose gateway supports batching MAY be a *batch-loader*: `load(key)`
returns a memoized promise, and every `load` in the same tick is **coalesced** into
one `batchLoad(keys)` call, keyed by the resolver's normalized input (normalized
address for geocode; id/path for a batched `getById`/`getByPath`; etc.). The loader
unifies per-key caching (#5) with batching. Because resolution is lazy and memoized
(#2), **batching is emergent**: when the flush drives every facade's `toMutation`
concurrently (ADR 0017 #3), their `load` calls land in one tick and batch
automatically — there is **no separate "prewarm" pass**. This is the general
N+1-avoidance mechanism for any batchable gateway. Keep the cache split by input
stability (#5): a value derived from a *stable* input (coordinates from a
normalized address) caches write-once; a value derived from *mutable reference
data* (a `location_path` from coordinates, which depends on the current geometries)
is a separate recomputable/invalidatable loader, not merged into the stable cache.

## Consequences

- One place and one pattern for canonical ids, foreign keys, coordinates, slugs,
  and constants.
- Composition and ordering are implicit in the `await` graph; no topological pass.
- Determinism comes from the durable cache plus normalized input fingerprints.
- Adding a resolvable property = attach a resolver; adding a resolution method =
  write one reusable resolver.
- `location_path` stays resolve-or-fail; entity identity stays find-or-create and
  stable.
- Circular property dependencies are a loud error, not a hang.
- The narrow separation ADR 0008 drew between the canonical-id ledger and cached
  values is intentionally removed.
- The durable resolver cache is part of the replayable archive (ADR 0002/0008) —
  preserved and uploaded with the workspace, not scratch.
- A resolver returns the value already in its **target column's datatype** (it
  knows the target field) — a `date` column gets a date, a `numeric` column a
  number, an FK its canonical-id string. The spec/mutation layer (the Zod record
  specs) still validates the assembled record as a safety net, but producing the
  correctly-typed value is the resolver's job, not a downstream coercion step.

## Alternatives Considered

- Keep `canonicalIdFromProperty` as a narrow FK→id method: rejected — it does not
  cover derived/generated/constant values and hardcodes the mapping.
- A central `DataContext` registry keyed by `(kind, property)`: rejected in favor
  of resolvers attached to facade properties (reusable, entity-agnostic,
  composable).
- Keep `SourceNameToCanonicalId` and `ResolvedProperty` separate (ADR 0008):
  revised — one durable resolver cache with per-property stability.
- An eager, pre-ordered resolution pass: rejected in favor of lazy memoized
  promises (composition and order fall out for free).

## Revisit Trigger

- When circular property dependencies become a genuine requirement.
- When a source genuinely cannot avoid a forward reference (would require relaxing
  decision #9 to reintroduce create-a-stub handling).
