## Why

Published record identities must survive intake reconstruction. An erroneous replacement mapping must be restored to its established original ID without redirecting the published URL or editing applied history.

## What Changes

Add a shared, explicit identity restoration command and append-only chain event with expected-current ID, original ID, reason, and evidence. Ordinary updates retain immutable primary keys. Recovery completes canonical ledger writes after the database transaction commits.

## Capabilities

### New Capabilities

- `identity-restoration`: Guarded restoration of established canonical identities.

## Impact

Shared CLI, canonical envelope IO, identity ledger, and chain execution. No schema migration, reset, generated taxonomy changes, or new dependencies.
