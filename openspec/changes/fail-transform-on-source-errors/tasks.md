## Implementation

- [x] Test first in `test/cli/transform/transform.integration.test.ts`: with an empty workspace, `data transform` with no source lists every source as skipped with their count and exits 0; with an invalid `state/gov/texas/tcole/acquire.yaml`, it lists `gov/texas/tcole` under "errored" with the pointer error, still skips the others, and exits 1.
- [x] `src/cli/transform/index.ts`: add `NoAcquiredInputError`; `sourceInputDir` throws it, with the existing message, when a source has no acquire pointer.
- [x] `src/cli/data/index.ts`: in the `data transform` loop with no source, list a source as skipped only for `NoAcquiredInputError`; list any other thrown error under "errored"; give the skipped count in the summary.

## Validate

- [x] Run `npm run validate`, including OpenSpec validation. No Supabase migration or loaded data changes, so no Supabase validation or integrity assertions apply.
