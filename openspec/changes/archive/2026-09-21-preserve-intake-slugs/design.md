## Context

Canonical IDs already come from SourceNameToCanonicalId. ResolvedProperty stores slugs by canonical entity identity, but the original slugs were not retained in this cache. Producer slug fields are correctly excluded from canonical slug ownership.

## Decisions

Use existing database slug for same-ID updates; preserve the current cache across reset; generate a slug under intake control only for new canonical records. Keep mapping IDs unchanged. Cache disagreements must fail visibly, never silently overwrite an established value. Explicit repair can replace the demonstrated bad cache value from reference evidence.

LocationPath paths and slug components are source fields already copied on create; existing paths are read operations. Verify they remain unchanged. Replay must reject changes to an established slug from previously prepared stale updates. No-op slug assignments can remain valid.

## Recovery

Read reference CSV and current local database by exact ID. Record source digests and all old/new values. Reject conflicts and unknown changes. Restore cache through canonical ResolvedProperty IO, preserve provenance, and update only affected slug columns transactionally. Do not merge missing identities or reset data.
