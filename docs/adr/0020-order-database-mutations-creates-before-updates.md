# ADR 0020: Order Database Mutations Creates-Before-Updates so Creates Batch

## Status

Proposed

> Extends [ADR 0018](0018-version-database-mutations-as-ordered-apply-once-migrations.md)
> (ordered apply-once mutations) and [ADR 0017](0017-intake-persistence-is-a-bespoke-orm.md)
> (bespoke ORM apply path).

## Context

A `DatabaseMutations` envelope is an ordered list of per-record `Create` /
`Update` mutations applied top to bottom in one transaction. Emission ordered
them by **FK-dependency of the record kind** (agencies before officers before
agency_officers …) so a create's foreign keys always target an already-applied
row. Within a kind, creates and updates were left **interleaved** in facade
(source) order.

The apply path is dominated by round-trips: for a full reload it issues one
`INSERT` per created row (~33k on the mn-post import), serialized on one
connection while Postgres sits idle. A multi-row `INSERT ... VALUES (…),(…)`
would collapse those into a handful of statements — but only if same-table
creates are **contiguous** in the stream. Interleaved updates break that
contiguity on any mixed (incremental) import.

## Decision

Order **every create before any update**, keeping FK-dependency order among the
creates and among the updates:

1. Creates first, in FK-dependency order (a row's FK targets are created first).
2. Updates after all creates, in FK-dependency order.

This is FK-safe:

- **A create's FK targets already exist.** Creates keep dependency order, so a
  create references only earlier creates or rows already in the database. A
  create never references a row that is merely _updated_ this import — that row
  pre-existed.
- **An update's FK targets already exist.** Any row an update references was
  either already in the database or created in the (earlier) creates phase.
- **An update never gates a create.** Moving all updates after all creates
  cannot strand a create, because no create depends on an update having run.
- **No slug/unique collision is introduced.** Emission checks slug uniqueness
  against the _current_ database row, so a create is never assigned a value that
  an update is concurrently freeing; running the create before that update is
  therefore safe.

The apply path exploits this directly: it batches the contiguous run of
same-table creates into bounded multi-row inserts (bounded by Postgres's 65,535
bind-parameter limit) and applies updates individually — **the first update in
the stream marks the end of the creates**, so no lookahead is needed.

## Consequences

- Full-reload imports (all creates) collapse ~33k single-row inserts into a few
  dozen batched statements, cutting the apply-path idle substantially.
- The emitted envelope's order changes: a mixed import now lists all creates
  then all updates rather than grouping strictly by kind. The order remains a
  deterministic function of the mutation set.
- Updates are still applied one row at a time — each carries `check`/`from`
  assertions validated against the current row, which have no batched form.
