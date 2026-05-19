# ADR 0002: Own Intake Archive and Idempotency

## Status

Proposed

## Context

The intake system must be able to completely reconstruct derived state from
accepted packages. Upstream manifests may point to mutable or externally managed
locations. Intake therefore needs its own archive boundary and integrity record.

Upstream packages may be regenerated later. A regenerated package with the same
identity but changed content must not silently alter previously filed data.

The database schema and migrations currently live under `supabase/`. The existing
`supabase/seed.sql` can populate the current schema, but it is transitional and
known to be the wrong long-term loading model.

## Decision

Intake owns the canonical archive. `intake file <manifest-ref>` always copies
accepted artifacts into intake-owned archive storage before loading derived
state.

The manifest describes upstream inputs only. It must not know or reference the
intake archive.

Package identity and idempotency rules:

- `metadata.id` is the stable package identity and must be a cuid2 text ID
  assigned upstream.
- The database must never generate IDs for durable records.
- Intake may assign canonical cuid2 IDs for new records during filing, but those
  assignments must be persisted in a durable source-key mapping ledger and
  replayed during reset.
- Intake records the manifest digest and each artifact digest at filing time.
- Filing a new package ID accepts the package if all validations pass.
- Filing the same package ID with identical digests is a no-op/report.
- Filing the same package ID with changed manifest or artifact digests is
  rejected as a package identity conflict.

Archive integrity rules:

- Store SHA-256 digests for manifests and artifacts.
- Verify source artifact digests before archive.
- Verify archived object digests after archive.
- Treat post-archive digest drift as corruption or unauthorized mutation.

Reset/load direction:

- Keep Supabase schema and migrations under `supabase/` for now.
- Move away from `supabase/seed.sql` as quickly as practical.
- `intake reset` rebuilds derived database state from the accepted
  archive/package index and source-key mapping ledger, not from seed SQL.
- While `seed.sql` exists, it remains subject to the repo's stable ID and
  conflict-free seed rules.

## Consequences

- Derived state can be rebuilt from the accepted archive/package index.
- Upstream systems cannot mutate intake history by changing external objects.
- Corrections require a new package identity or a future explicit supersession
  package type.
- Archive storage becomes part of the product contract.
- `seed.sql` should shrink or disappear as archive-driven loading becomes the
  reset source of truth.

## Alternatives Considered

- Trust upstream S3/object locations as the archive: rejected because upstream
  storage is not intake-owned and may change independently.
- Overwrite existing package records when regenerated: rejected because it breaks
  append-only history and deterministic rebuilds.

## Revisit Trigger

Revisit when an explicit correction/supersession workflow is needed.
