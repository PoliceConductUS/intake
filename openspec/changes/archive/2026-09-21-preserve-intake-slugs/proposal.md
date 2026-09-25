# Preserve intake slugs

## Why

Re-imports can accept producer slugs or bypass established canonical cache values and change public URLs for the same record ID.

## What Changes

Preserve established slugs by canonical kind and ID, including across database resets. Source slug fields do not override canonical slugs or own system uniqueness. Cache each intake-resolved slug. Reject replay changes to established IDs, slugs, and location paths.

## Capabilities

### New Capabilities

- `canonical-slug-preservation`: stable canonical URL identity through import and replay.

## Impact

Current import facades, property cache integration, slug allocation, and mutation replay. Refresh the FederalAgency source contract to classify slug as intake-resolved (optional source input, required database create value). No migrations, seed edits, database reset, dependencies, or downstream database schema changes. Previously repaired local data is preserved; this change prevents recurrence.
