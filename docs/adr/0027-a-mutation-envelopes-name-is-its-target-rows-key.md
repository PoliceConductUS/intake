# ADR 0027: A Mutation Envelope's `metadata.name` Is Its Target Row's Key

## Status

Accepted

> Refines ADR 0018 (versioned database mutations) and ADR 0020 (order creates
> before updates). Internal to the import → replay boundary; it does not change
> what a source sees (ADR 0023 still holds — sources never receive canonical ids).

## Context

Each database mutation is a typed envelope whose `kind` is `<RecordKind><Operation>`
(e.g. `AgencyUpdate`, `LocationPathRead`) and whose `metadata.name` names the
record. Replay derives the target table and key column from `kind`, and must then
locate the specific row to act on.

For creates that row identity is in the spec (`{ id, ... }`), and replay keys on
`spec[keyColumnName]`. For updates the spec is only `{ operations }` — it carries
no id — so replay locates the row by `metadata.name` against the key column.

That worked for the natural-key kinds (`LocationPath`, `LocationPathAlias`), whose
`metadata.name` was already set to the identity value (`location_path_id` /
`alias_path`) — i.e. the key-column value. But the id-keyed kinds set
`metadata.name` to the **source name** (the namespace-local key, ADR 0023), which
is never the canonical `id` stored in the row. An update to an existing id-keyed
entity therefore looked up `WHERE id = '<source-name>'`, found nothing, and threw
`cannot update missing <Kind>`. It was masked only because check-only updates are
dropped (ADR 0011/0014) and no replay test exercised a genuine field change — so
the first import (all creates) and an unchanged re-import (check-only, dropped)
both avoided it, and only re-importing an existing entity with a changed field
would trip it.

## Decision

**A single mutation envelope's `metadata.name` is the value of its target row's
key column** — the canonical `id` for an id-keyed entity, the natural key
(`location_path_id`, `alias_path`) for the natural-key kinds. The pair is uniform:
`kind` says _which table and operation_, `metadata.name` says _which row_.

- Every kind's create, update, and read envelope sets `metadata.name` to the
  resolved identity value. There is no per-kind "source name vs identity"
  choice; the identity value is always the name.
- Replay reads the row to update (or read) by `keyColumnName = metadata.name`,
  and this now always matches — the create inserted that same key.
- The source name remains the record's key in the source/artifact and in the
  ledger (ADR 0023); it is simply not what identifies a row to the database.

## Consequences

- Updates to existing id-keyed entities resolve their row and apply, instead of
  failing loud on a phantom lookup.
- Envelope/chunk file names for id-keyed kinds become canonical ids rather than
  source names — less human-readable, but the durable, collision-free identity.
- The `metadataName` facade option is removed; the engine always uses the
  identity value.
- A replay integration test covers a genuine update (insert a row, replay a
  `set`, assert the field changed) so the id-keyed update path can no longer
  regress unobserved.

## Alternatives Considered

- **Carry the id inside the update spec** (a top-level `id` or a `check` on `id`)
  and keep readable source-name envelopes: rejected — it duplicates the identity
  the `kind`+`name` pair is meant to express and widens the mutation schema, for
  only a readability gain.
- **Fix updates only, leave creates named by source name:** rejected — it leaves
  the same entity's create and update envelopes disagreeing on identity, which is
  the confusion that produced this bug.

## Revisit Trigger

Revisit if a persisted entity ever needs a compound or non-column key that a
single `metadata.name` cannot express.
