# ADR 0033: Data Mutations as a Replayable Chain

## Status

Proposed

> Builds on the DatabaseMutation model (ADR 0020), the resolver/facade diff engine
> (ADR 0016), and the recent update-diff fixes (value-equality for jsonb;
> absent-field omission). It reframes how mutations are stored, ordered, and
> applied — turning them into the database's authoritative history.
>
> **Amended by ADR 0034:** the chain directory is _not_ committed — it lives in the
> workspace, coupled to the cache that mints its ids (superseding the "chain
> directory is committed" consequence below). And §4's curated mutations name their
> target by a selector resolved at generate time, not by a canonical id.

## Context

Today a `run` produces `Artifacts` (the source's desired-state records) and
`import` **diffs those against the current database**, emitting a
`DatabaseMutations` envelope of only the differences, which it applies immediately.
The envelope is a per-command throwaway: it is not ordered against other runs, not
retained as a record, and re-running the same acquired source against unchanged
state produces an **empty diff — no mutations**.

That last fact is the key: **a mutation _is_ a delta.** A stable source contributes
nothing; only a genuine change (new acquired data, a new source, a manual
correction) produces a mutation. So the full set of non-empty deltas, in the order
they were produced, _is_ a complete, replayable history of the database — the same
shape as schema migrations.

The goal is a database you can **reconstruct by replaying that history**, rather
than by re-running every source. Re-running sources cannot reconstruct anyway: an
import diffs against current state, so re-importing an already-applied source is a
no-op.

## Decision

Data mutations become an **ordered, immutable, ledger-tracked chain** — the
database's event log. A database is rebuilt by **replaying the chain**, not by
re-running sources.

**1. The chain is the source of truth; reconstruction is replay.** Rebuild =
fresh database → apply schema migrations → **replay the data-mutation chain in
order**. Sources are no longer how database _state_ is produced; they are how the
_next delta_ is produced. You run a source only to turn newly-acquired data into
the next chain entry. Acquired snapshots remain the raw truth; the chain is the
derived, materialized history committed alongside them.

**2. An entry is a `DatabaseMutations` envelope that names its predecessor.** The
chain reuses the existing envelope format — no new type. `generate` stamps two
things into the envelope's metadata: its own **data-mutation version** and the
**previous version** (the chain head at generation). The chain is therefore a
linked list encoded in the files themselves — each entry names its parent — not
merely a filename ordering. Entries live at `data-mutations/NNNNNN-<slug>.yaml`
(zero-padded, human-readable order), but the parent pointer is the authority: an
entry cannot apply unless its predecessor is applied, and the pointers make
reordering or a missing entry fail loud. Entry N's diff was computed against the
state entry N−1 leaves, so the chain is a strict total order across all sources and
manual edits — not per-source. Once written and applied, an entry is never edited; a
correction is a new entry (or a down + new up).

**3. Generation and application are separate steps (Liquibase-style).** Producing
a mutation and applying it are two commands. `run` writes `Artifacts` to its
command-output folder as today. A separate **`data-mutations generate <command-
output>`** diffs that output against the database — which must be at the chain
_head_ — and writes the non-empty delta as the next
`./data-mutations/NNNNNN-<slug>.yaml` envelope, stamping its own version, its
predecessor's version (the current head), and a checksum; the schema min-version is
already carried by the envelope's `databaseSchema.appliedMigrations` (its max). It
applies nothing; an empty diff writes no file. **`data-mutations
up`** then applies pending entries. (This is exactly what today's `import` did in
one shot; it splits into generate + up — you author changesets, then run them.)

**4. Curated mutations come from the manual source, not by hand.** A curated delta
(an officer's badge, a location alias) is produced by **running the manual curation
source** (ADR 0031): its search resolves the reference — you pick the target and it
persists the target's source key (ADR 0023) — and it emits the record(s); `generate`
turns that run's output into the next chain entry, exactly like any source. The
absent-field-omission rule (a source writes only the fields it provides) is what
lets a curated record express a _field-level_ update — set only `badge_number` —
without re-supplying every column, so a manual edit is a minimal, safe delta.
Prerequisites: the manual source's search must be wired, and `AgencyPersonnel`
added to its handled kinds with a bulk path for many rows. There is no separate
"manual" mechanism; the chain unifies source-derived and curated mutations.

**5. A ledger tracks what is applied.** A schema migration creates
`data_mutation_applied(version, previous_version, checksum, applied_at)`. `up`
applies each pending entry whose predecessor is already in the ledger, in order,
recording its version; `down` reverts from the head to
a target. On a fresh database the ledger is empty, so the whole chain replays.

**6. The `from`-checks are the real ordering guarantee.** Beyond ledger
bookkeeping, each entry's `check`/`from` values _are_ the state after the prior
entry, so applying out of order fails loud. The ledger is an optimization and an
audit record; the from-checks enforce integrity. (This now holds reliably because
value-equality compares jsonb by value, and absent-field omission keeps each source
the sole writer of the fields it manages — so deltas are minimal and downgrade's
"sole-writer" assumption is real.)

**7. Schema coupling is a minimum-version gate.** Each entry records its schema
**min-version** — `max(appliedMigrations)` at generation. `up` requires the
database schema to be at **≥** that version, and permits later versions. This is
forward-compatible and self-correcting: if a later schema migration drops or renames
a column an entry writes, the entry fails loud at replay ("column not found") — the
signal that this model has met its first real conflict, surfaced automatically
rather than predicted. Schema migrations stay their own chain, applied first.

**8. Replay is deterministic because entries are materialized.** An entry stores the
resolved `to` values, not a recompute. Replay applies recorded results — no
re-geocoding, no live resolution. All non-determinism stays quarantined in
`acquire`/generation, exactly as today; replay is pure.

**9. Down is supported but scoped.** A `set` reverses by swapping `to`↔`from`; a
curated `create` reverses to a delete. Downgrade is sound **only while the chain is
the sole writer** of the affected fields — which absent-field omission now makes
true. It is lossy by nature (reverting a create deletes data) and is documented as
such.

**10. CLI verbs mirror Liquibase / schema migrations.**
`intake data-mutations generate <command-output> | status | up [--to N] | down
[--to N] | verify`. `generate` authors the next changeset (§3); `up`/`down` apply
and roll back; `replay database-mutations <file>` becomes the low-level primitive
underneath `up`; `verify` recomputes checksums of applied entries and fails on any
drift.

## Consequences

- **New schema migration** creating `data_mutation_applied`.
- **`import` splits into two commands.** Its mutation-generation half becomes
  `data-mutations generate` (diff a run's command-output against the database →
  write the next `./data-mutations/` entry, applying nothing); its apply half
  becomes `data-mutations up`. Generation and application are never the same step.
- **The chain directory is committed** and becomes part of the repository's
  source-of-truth, next to the acquired snapshots. Its genesis is the first full
  import against an empty database (the big initial create-set), followed by every
  subsequent delta.
- **Reconstruction docs/tooling** shift from "re-run all sources" to "apply schema
  migrations, then `data-mutations up`." The existing full-reconstruction path can
  remain as the _generator_ of the genesis chain, run once.
- **Migration path:** (a) land the ledger migration; (b) run one clean
  reconstruction against an empty database, `generate`-ing each run's output into
  the ordered genesis entries; (c) retire `import`'s apply half in favor of
  `data-mutations up`; (d) produce the badge backfill and city aliases as manual-
  source runs, `generate`-d into the next entries.

## Alternatives Considered

- **Reconstruct by re-running sources (today).** Rejected as the primary path: an
  import diffs against current state, so re-running an applied source is a no-op — it
  cannot rebuild an empty database, and it re-does non-deterministic resolution
  needlessly. Kept only as the genesis _generator_.
- **A separate immutable chain for manual mutations only, sources stay
  declarative.** Rejected: since a stable source already emits an empty diff, there
  is no tension — one unified chain is simpler and captures source deltas as history
  too.
- **Exact schema-fingerprint match per entry (current replay behavior).** Rejected
  in favor of a min-version gate: exact match would break the chain on any forward
  schema evolution, defeating replay.

## Revisit Trigger

The chain grows large enough to want compaction/squashing (a new genesis); a second
concurrent writer appears (the append flow assumes a single writer — manual, not
CI); a schema change legitimately needs to rewrite historical entries (forcing a
squash rather than an edit); or downgrade needs to span fields with a competing
writer.
