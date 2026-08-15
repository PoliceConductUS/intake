# ADR 0017: Intake Persistence Is a Bespoke ORM (Unit of Work + Data Mappers)

## Status

Proposed

## Context

Across ADR 0011 (`DataContext` responsibilities), ADR 0016 (composable resolvers),
and the facade migration, a coherent persistence structure emerged — and it is,
in fact, a bespoke object-relational mapper. Naming it in the standard PoEAA
vocabulary resolves a design question that was otherwise ambiguous: does putting
"mutation planning" in `DataContext` overload it (an SRP violation), or is it
where it belongs?

It also settles how a query builder / ORM tooling relates to the hand-rolled
code, and where the responsibilities that `plan-database-mutations` currently
bundles (transaction lifecycle, schema load, batch geocoding, aggregate error
reporting, exclusion cascade) actually live.

## Decision

**1. The intake persistence layer is a bespoke ORM built on classic PoEAA
patterns:**

- **`DataContext` = Unit of Work + Identity Map** (the ORM *session*; cf. EF
  `DbContext` / LINQ-to-SQL `DataContext`). It tracks the entities touched in a
  command, resolves their identities, and builds the batch of changes. **Building
  the mutation set is a Unit of Work's job — not an overload.**
- **Facades = Data Mappers.** Each maps one entity between object form and DB
  rows; `toMutation` is change-tracking → create/update generation (the object↔SQL
  boundary).
- **Resolvers = Lazy Load + attribute/association resolution** (ADR 0016). The
  memoized async `value<K>(): Promise<Row[K]>` accessor is Lazy Load; FK resolvers
  are Foreign-Key Mapping; `findForeignKeyTarget` is the Identity Map lookup.
- **The `SourceNameToCanonicalId` ledger = the Identity Map's durable half** —
  `source-key → canonical-id`, so identity survives across runs; find-or-create is
  "get-or-materialize in the identity map."

**2. Keep the mutation envelope as the ORM's output.** The ORM produces a
deterministic, auditable, **replayable** mutation envelope (check/set with
expected-prior-values), not live SQL. This is load-bearing across ADR 0002
(idempotent archive), 0011 (replay), and 0013 (command auditability). The ORM does
not execute; it builds the envelope; a separate executor applies it.

**3. SOLID split — `DataContext` builds; a thin flush/transaction script commits.**
`DataContext` (the Unit of Work) owns resolution + envelope building, depending on
**injected IO abstractions** — a read-only DB client, a geocoder, a schema
provider, the ledger persist-writer (DIP; OCP for new entities via new facades /
resolvers). The command-planning stage (formerly `plan-database-mutations`) slims
into a thin flush/transaction script: open the read transaction, wire the injected
IO into `DataContext`, and drive the facades' `toMutation` **concurrently**
(`Promise.allSettled`), which does two things at once — it **catches per-entity
failures and aggregates them into the `DatabaseMutationsDebug` envelope**, and it
makes **batch-loader coalescing (ADR 0016 #10) emergent**: the batched geocoder
(and any other batchable gateway) becomes a single coalesced `load` across
agencies in one tick, so there is **no separate geocode prewarm stage**. The flush
then hands off the built envelope. It does **not** dissolve into `DataContext`.
(Resolvers fail fast
individually per ADR 0016 #3; the flush aggregates.)

**4. A query builder, not a full ORM, for SQL.** A full ORM (Prisma / TypeORM /
MikroORM) is rejected — it executes on flush and hides SQL (no serializable
check/set envelope), keys identity by DB-generated primary key, and ships its own
Unit of Work that duplicates `DataContext`. A type-safe **query builder (Kysely or
Drizzle)** is the intended tool for SQL generation and the read side: it compiles
to serializable `{ sql, parameters }` **without executing**, so the envelope is
preserved. **The envelope is the seam** — swapping SQL generation to a query
builder later touches only the executor / read side, not the facades or resolvers.

## Consequences

- "Is `DataContext` overloaded by mutation planning?" is settled: it is a Unit of
  Work, and producing the mutation batch is its single responsibility. Only the
  transaction lifecycle, IO, and aggregate-error reporting live outside it.
- Resolution logic is unit-testable with fake gateways; the flush/transaction
  script is the composition root that wires the real IO.
- The persistence layer can adopt a query builder incrementally, because the
  envelope decouples mutation *building* from *execution*.
- No off-the-shelf ORM is adopted; its execution model and DB-generated identity
  conflict with the replay envelope and source-key identity.

## Alternatives Considered

- **Fold mutation planning into `DataContext` as a big context:** reframed rather
  than rejected — building mutations *is* the Unit of Work's job; only the
  transaction/IO/aggregate-reporting move out to the flush script.
- **Adopt a full ORM (Prisma/TypeORM/MikroORM):** rejected — couples planning and
  execution, hides SQL, assumes DB-generated identity, and duplicates the Unit of
  Work; fights the replay envelope.
- **Emit SQL directly and drop the envelope:** rejected — loses deterministic
  replay, the drift-check on update, and command auditability (ADR 0002/0011/0013).
- **Three-layer split (`DataContext` = symbol table only + separate
  `MutationBuilder`):** rejected as over-separation; Unit of Work + Data Mapper is
  cohesive (a mapper's `toMutation` needs its resolved properties).

## Revisit Trigger

- When adopting the query builder (Kysely / Drizzle) for SQL generation and
  execution.
- If mutation-building develops independent variation that warrants its own
  collaborator separate from the Unit of Work.
