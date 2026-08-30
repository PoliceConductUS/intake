# ADR 0018: Version Database Mutations as Ordered, Apply-Once Migrations

## Status

Accepted

> **Command surface superseded by [ADR 0033](0033-data-mutations-as-a-replayable-chain.md),
> [ADR 0035](0035-one-data-command-group-replaces-run-and-import.md), and
> [ADR 0036](0036-rename-the-produce-phase-from-run-to-transform.md):** the fused
> `intake run` (produce _and_ apply) is retired — produce is `data transform` /
> `data generate`, apply is `data up`. The apply-once, ordered-migration model this
> ADR introduced is what those ADRs build on.

## Context

Today `intake run` both **produces** a `DatabaseMutations` envelope and **applies**
it to the database in a single step, and the envelope lands in an ephemeral
per-command workspace directory. Nothing durably records **which data changes have
landed in a given database** — there is a schema version (Supabase
`schema_migrations`) but no data version.

Three properties of the envelope, already established in prior ADRs, turn out to
be the definition of a migration:

- **Non-idempotent.** Replaying an envelope a second time fails loud, by design: a
  `create` refuses to insert an existing row, and a `set`'s `from` pre-image guard
  (and any `check`) refuses when the current value no longer matches (ADR 0011,
  ADR 0014). The envelope is a one-shot forward transition, not a repeatable
  operation.
- **Order-dependent.** `us-census-gazetteer` must apply before any source that
  geocodes against its `location_path` boundaries (ADR 0015); each source's
  envelope assumes its predecessors have landed.
- **Pre-image-guarded.** Every operation asserts the exact database state it was
  planned against, so an envelope is only valid against one specific database
  version.

A one-shot, ordered, precondition-checked forward transition **is** a migration.
This ADR names that and gives it the discipline schema migrations already have:
apply exactly once, in order, with a durable record of what has been applied.

We also want what a migration ledger buys: a **data version** ("you are here" for
data), **apply-once safety** enforced structurally rather than by operator care,
and the ability to **promote the same data changes across environments**
(generate once locally, apply to staging then prod) instead of re-running the
importer against each database and hoping for the same result — which matters
because import-time geocoding is a **live, non-deterministic network call**.

## Decision

**1. Each `DatabaseMutations` envelope is a migration** — authored once, applied at
most once to any given database, in a fixed order. `run` stops being
"produce-and-apply in one breath."

**2. Migrations live in a committed folder in this repository** (a `mutations/`
directory) that becomes the **system of record**, replacing reliance on ephemeral
workspace command directories. Chunk `.records/` directories travel with their
top-level envelope. Each migration is identified by its **run id** (the existing
cuid2 command id) — no invented sequence numbers. Filenames may carry a
timestamp/run-id prefix for human scannability, but they are a convenience, not
the authority (see point 3).

**3. Order is a parent-pointer chain, and a tracking table records the data
version.** Every migration carries, in its envelope metadata, its own `id` (the
run id) and a **`depends_on`** — the id of the migration at the current database
head, read from `applied_mutation` when the migration is created. The first
migration's `depends_on` is an **all-zero genesis sentinel** (git's null-parent
convention). `applied_mutation` in the target database holds one row per applied
migration — `id`, `depends_on`, `sha256`, `namespace`, `mutation_count`,
`applied_at` — and is to data what `schema_migrations` is to schema; `sha256`
catches an already-applied file edited after the fact.

The **chain is the authoritative order**, validatable from the files alone: walk
`depends_on` from the genesis sentinel to the single head. Two migrations sharing
a `depends_on` is a detectable **fork** (the concurrent-authoring conflict); a
`depends_on` naming an absent id is a **gap**. "Is this database at head?" is then
"does the applied chain end at the last file?" This holds because `create`
requires the database at head, so a migration's parent is always exactly the
last-applied migration — the chain cannot branch as long as creation follows the
precondition.

**4. The pre-image guards are the migration's precondition.** `from`/`check` assert
the exact pre-state; apply fails loud on any mismatch. A migration is therefore
**self-verifying** — it can only apply to the database version it was planned
against. This refines ADR 0017's "replayable": _replayable_ means
**deterministically applyable against its expected pre-state, once** — not
idempotently repeatable.

**5. The CLI is a migration runner.**

- `intake mutation create <glob>` — assert the database is at head (the applied
  chain ends at the last committed migration, every `sha256` matching), run the
  matched source(s), diff against the current database, and write a new migration
  whose `depends_on` is the current head **only if the diff is non-empty**. An
  empty diff (the check-only-drop of ADR 0011/0014) writes no migration and
  reports "no change" — the data version does not advance for nothing.
- `intake mutation apply [--to <id>]` — apply each pending migration in chain
  order; each migration and its `applied_mutation` row commit in **one
  transaction**, so a crash never half-versions. Fail loud on any guard mismatch.
- `intake mutation status` — applied vs. pending: the schema-plus-data version.
- `intake run` becomes sugar for `create` then `apply`.

Because `create` requires the database at head, **ordering is enforced, not merely
conventional**: tcole's migration cannot be created until census's is applied
(tcole needs census's `location_path` rows to resolve). The dependency order is
emergent from the create precondition; the folder order records what the data
already forced.

**6. Forward-only.** No down-migrations. Data rollback is rarely safe to automate
even though the operations are technically invertible (swap `from`/`to`,
create↔delete). Recovery is a restore from backup or a new forward migration.

**7. The committed migrations are the source of truth; workspace state is a
derivable projection.** Every `create` records `(namespace, kind, source-name) →
canonical id` (envelope `metadata.namespace` + item `kind` + `metadata.name` →
`spec.id`) plus the resolved property values (coordinates, `location_path_id`,
and any manual overrides baked in). So the `SourceNameToCanonicalId` ledger (the
Identity Map's durable half, ADR 0017) and the resolved-property cache can be
**rebuilt by scanning/replaying the migration history**. Workspace state is a
rebuildable materialized view, not primary data.

**8. Out-of-band and manual resolutions become committed inputs.** Anything a human
supplies that the automated resolvers cannot (e.g. hand-assigned coordinates for
agencies whose only address is a PO box or is missing entirely) enters as a
committed input and is baked into the create mutation. Once in a migration it is
recoverable forever, with no network dependency — the live geocoder never has to
reproduce it.

## Consequences

**Positive.**

- A durable **data version** and an auditable, ordered history of every data
  change.
- **Apply-once safety is structural** (the tracking table + pre-image guards),
  not dependent on the operator not re-running.
- **Deterministic ordering** falls out of the create precondition.
- **Environment promotion**: generate the migration once, commit it, apply the
  same file to local → staging → prod.
- **Non-determinism is quarantined.** Live geocoding happens at `create` and is
  frozen into the migration; `apply` is pure and deterministic.
- The **workspace becomes a rebuildable cache** — losing or corrupting it is
  recoverable from the committed migrations (see restore, deferred below).

**Negative / accepted trade-offs.**

- **Strict linear chain.** A migration diffs against the exact prior database
  state, so migrations cannot be cherry-picked, reordered, or regenerated in the
  middle without invalidating every successor. (For reproducibility this rigidity
  is a feature.)
- **Merge conflicts.** Two people generating migrations off the same parent
  conflict exactly as two schema migrations do; resolution is re-generate on top
  of head.
- **Monotonic growth.** The folder is an append-only log; periodic
  squashing/checkpointing may eventually be wanted (out of scope here).
- `applied_mutation.applied_at` is a clock value — a non-deterministic audit
  column, acceptable exactly as `schema_migrations` is.

**Relationship to existing ADRs.** Extends ADR 0017 (the ORM's output envelope
becomes a tracked migration); operationalizes ADR 0011 / ADR 0014 replay and the
check-only-drop; encodes ADR 0015 ordering as folder order plus the create
precondition; complements ADR 0002 / ADR 0013 auditability.

## Deferred

- **Workspace restore.** The rebuild-from-migrations capability (point 7) is a
  property this design guarantees, not a tool to build now. Implement
  `mutation restore` (or equivalent) only when a real loss/corruption need
  arises; until then the property stands as documented insurance.
- **Migration squashing/checkpointing** for a folder that has grown large.
