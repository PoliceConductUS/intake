# ADR 0002: Own Intake Archive and Idempotency

## Status

Accepted

## Context

The intake system must be able to completely reconstruct derived state from
accepted source artifacts. Source-produced `Artifacts` envelopes may point to
mutable or externally managed locations. Intake therefore needs its own archive
boundary and integrity record.

Source artifacts may be regenerated later. Regenerated artifacts with the same
envelope identity but changed content must not silently alter previously
imported data.

The database schema and migrations currently live under `supabase/`. The
existing `supabase/seed.sql` can populate the current schema, but it is
transitional and known to be the wrong long-term loading model.

## Decision

Intake owns the canonical archive and replay ledger.
`intake import artifacts <artifacts-ref>` reads a source-produced `Artifacts`
envelope, writes an intake-owned `DatabaseMutations` replay envelope, and applies
the prepared mutations unless `--dry-run` is set.

Command history, command-local logs, and replay order are part of the archive
and audit contract. See ADR 0013 for command auditability.

Source-produced envelopes describe upstream inputs only. They must not know or
reference intake archive locations, replay runs, or canonical database IDs.

Identity and idempotency rules:

- Source-produced envelope identity is
  `apiVersion + kind + metadata.namespace + metadata.name`.
- `DatabaseMutations.metadata.name` is a new unique cuid2 created by intake for
  each successful prepared import.
- The `DatabaseMutations` command directory is prefixed with the creation
  timestamp and the encoded `metadata.name`.
- The database must never generate IDs for durable records.
- Intake may assign canonical cuid2 IDs for new records during import, but those
  assignments must be persisted in a durable source-name mapping ledger and
  replayed during reset.
- Intake records the source `Artifacts` digest and each referenced artifact
  digest at import time.
- Importing a source `Artifacts` envelope fails if a successful `DatabaseMutations`
  already exists for the same source `metadata.namespace` and `metadata.name`.
- Replaying an existing `DatabaseMutations` envelope does not read source
  artifacts, SourceNameToCanonicalId records, or artifact mutations.

Archive integrity rules:

- Store SHA-256 digests for source envelopes and artifacts.
- Verify source artifact digests before archive.
- Verify archived object digests after archive.
- Treat post-archive digest drift as corruption or unauthorized mutation.

Reset/load direction:

- Keep Supabase schema and migrations under `supabase/` for now.
- Move away from `supabase/seed.sql` as quickly as practical.
- `intake reset` rebuilds derived database state from the accepted archive,
  `DatabaseMutations` replay ledgers, and source-name mapping ledger, not from seed
  SQL.
- While `seed.sql` exists, it remains subject to the repo's stable ID and
  conflict-free seed rules.

## Consequences

- Derived state can be rebuilt from the accepted archive and replay ledgers.
- Command history can be audited from namespace-scoped command folders.
- Upstream systems cannot mutate intake history by changing external objects.
- Corrections require new source artifact identity or explicit
  `ArtifactMutations`/`ArtifactMutation` envelopes that produce a new
  `DatabaseMutations` ledger.
- Archive storage becomes part of the product contract.
- `seed.sql` should shrink or disappear as archive-driven loading becomes the
  reset source of truth.

## Alternatives Considered

- Trust upstream S3/object locations as the archive: rejected because upstream
  storage is not intake-owned and may change independently.
- Overwrite existing imported records when source artifacts are regenerated:
  rejected because it breaks append-only replay history and deterministic
  rebuilds.

## Revisit Trigger

Revisit when an explicit correction/supersession workflow is needed.
