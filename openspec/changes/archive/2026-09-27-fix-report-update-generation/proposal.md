## Why

`data generate` silently ignores changed reports because Review uses read-only re-import behavior. This contradicts the command's promise to generate source deltas.

## What Changes

- Resolve existing Review records through normal diff-and-update planning.
- Verify changed manual reports through the CLI pipeline and unchanged reruns as no-ops.
- Compare equivalent whole-second timestamp representations as the same instant across generation and replay.
- Require an explicit timezone on timestamp input, as requested by the user.
- Truncate fractional seconds in generated values, database writes, and comparisons while preserving raw source values.

## Capabilities

### New Capabilities

- `report-update-generation`: generate and apply report edits while preserving identity.

### Modified Capabilities

- None.

## Impact

Affects Review resolver configuration, generated timestamp field validation, timestamp comparison in generation/replay, and focused tests. Timestamp input now requires `Z` or a numeric UTC offset; date-only fields retain their existing contract. No database schema, seed, migration, or reset changes. Existing applied data history is preserved. The requested title restoration was applied through the CLI; this validation change requires no further production data writes.
