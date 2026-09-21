## Why

Intake regenerated published personnel slugs while retaining IDs, breaking 129,924 published URLs in the audited next-release dataset. Agency slugs must obey the same canonical ownership rule.

## What Changes

- Preserve canonical IDs and existing slugs during imports.
- Keep slug assignment under intake control; producer fields cannot assign system slugs.
- Preserve cached slugs across resets and source name changes.
- Restore affected exact-ID slugs from the retained reference backup, with before/after evidence.

## Capabilities

### Modified Capabilities

- `artifacts-database-import`: preserve established IDs and slug fields.

## Impact

Import transformation, planning, resolved-property cache, regression tests, and local dataset correction. No schema migration, reset, generated contract change, or deployment. Production rollout requires corrected data and a fresh site build.
