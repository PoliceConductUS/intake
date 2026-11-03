## Why

Agency location resolution can accept existing county or state IDs through caches and supplied values, violating the required place-only invariant.

## What Changes

- Reject any agency location path whose level is not `place`, whether supplied, cached, or freshly resolved.
- Add regression tests for state and administrative-area IDs and preserve valid place resolution.

## Capabilities

### Modified Capabilities

- `artifacts-database-import`: Enforce place-only agency location resolution at every return path.

## Impact

Agency resolver and canonical cache IO, regression tests, and a database migration. Delete invalid agency location-path cache records. Enforce the referenced row's place level with a generated constant column and composite foreign key; the user will reset through `npm run cli -- data reset --no-acquire`. No guessed place assignments.
