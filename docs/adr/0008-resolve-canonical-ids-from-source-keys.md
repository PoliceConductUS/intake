# ADR 0008: Resolve Canonical IDs from Source Keys

## Status

Proposed

## Context

Many upstream sources include stable record identifiers. When they do, intake
should preserve and use those identifiers instead of replacing them with
producer-generated IDs.

Other sources do not include stable IDs. For those records, the upstream producer
must derive a stable source-local key from source data that uniquely identifies
the record within that source.

The database must still never generate IDs for durable records. However, that
does not mean every canonical entity ID must be assigned by the upstream
producer. Intake can assign canonical cuid2 IDs as long as those assignments are
deterministic across filing and reset through a durable source-key mapping.

## Decision

Separate source identity from canonical identity.

Upstream package producers must provide source identity for each durable record:

- `source.name` or another unique source namespace
- source-provided stable ID when one exists
- producer-derived stable source key when the source has no stable ID
- provenance showing how the source key was obtained or derived

Intake resolves canonical IDs from the tuple:

```text
source namespace + source record key
```

Resolution rules:

- If the source-key mapping already exists, intake reuses the mapped canonical
  ID.
- If the source-key mapping does not exist and the package can create that kind
  of record, intake assigns a new cuid2 canonical ID and records the mapping.
- Intake-assigned canonical IDs must be stable for a filing run, persisted in the
  intake archive or mapping ledger, and replayable during `intake reset`.
- The database must not generate canonical IDs. ID assignment happens in intake
  before database writes.
- Natural-key matching can be used as evidence for candidate duplicate
  detection, but not as a replacement for durable source-key mappings.

The mapping ledger is part of the intake-owned archive/rebuild contract.

## Upstream Feedback

Intake should be able to produce feedback artifacts that upstream producers can
consume on later runs, such as:

- source-key to canonical-ID mappings
- canonical slugs
- duplicate or merge decisions
- rejected records with reasons
- source keys that need stronger derivation or manual review

This feedback is an optimization for producer quality and repeatability. It must
not become the only source of truth. Intake remains able to rebuild from the
archive and mapping ledger without relying on a producer's local cache.

## Consequences

- Upstream producers can pass through source IDs when present.
- Producers without source IDs can still be deterministic by deriving stable
  source-local keys.
- Intake owns canonical ID assignment for newly accepted records.
- Rebuilds remain deterministic because source-key mappings are durable intake
  artifacts.
- Duplicate detection can use source-key mappings, aliases, slugs, and natural
  keys as evidence without letting the database invent identity.

## Alternatives Considered

- Require upstream producers to assign all canonical cuid2 IDs: rejected because
  it pushes global identity decisions into source-specific tools.
- Let the database generate IDs: rejected because it breaks deterministic reset
  and makes package filing order part of identity.
- Use natural keys directly as canonical identity: rejected because names, dates,
  and URLs can change, collide, or be corrected.

## Revisit Trigger

Revisit when the first producer consumes intake feedback artifacts or when entity
merge/split workflows require explicit mapping versioning.
