## Implementation

- [x] 1. Reproduce skipped changed report with a failing CLI integration regression.
- [x] 2. Remove the Review read-only override and prove changed edits apply and unchanged input is a no-op.
- [x] 3. Run focused tests, type checking, OpenSpec validation, and review the scoped diff.

- [x] 4. Reproduce and fix explicit-zone incident timestamp update validation through the same CLI regression; verify the requested title-only edit through CLI.
- [x] 5. Require an explicit timezone on timestamp input and verify canonical envelope rejection plus existing zoned report behavior.
- [x] 6. Require whole-second incident timestamps, simplify comparison, and verify rejection of nonzero fractions plus whole-second update/no-op/replay behavior.
- [x] 7. Replace fractional rejection with user-requested truncation through generation, create/update writes, and comparisons while preserving raw source values.
- [x] 8. Reproduce and reject impossible calendar dates before timestamp normalization; preserve valid leap dates, offsets, and fractional source values.
