## Why

The added shared Personnel refinements reject source artifacts before existing
generation-time corrections can run. The user requested restoration of the
original implementation, without moving corrections or adding stages.

## What Changes

- Restore database-derived Personnel string schemas and original update validation.
- Remove the added letter-bearing-name and suffix-allowlist refinements.
- Preserve source candidates, explicit audited exclusions, existing Model behavior,
  generation-time corrections, explicit unset, and detailed validation errors.

## Impact

Regenerate envelope contracts. No migration, seed change, reset, or database write.
This restores the original behavior; it does not relocate the removed refinements.
