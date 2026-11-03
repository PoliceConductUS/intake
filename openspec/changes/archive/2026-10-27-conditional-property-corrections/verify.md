# Verification

## Final Census identity and generation design — 2026-09-25

Census transformation now emits geography-type-plus-GEOID keys. Shared generation
applies workspace corrections before deriving paths and aliases. There is no
Census correction hook and no merging of distinct places with colliding paths.

- Regression tests first reproduced early transform collisions, missing derived
  paths, corrected references bypassing canonical-ID resolution, and conflicting
  aliases silently converging. All now pass.
- The broad targeted run passed 468 tests across 52 files. After review fixes,
  the cache/correction and artifact-generation suite passed 284 tests across
  21 files. Ledger/cache and Census identity checks passed another 36 tests
  across three files.
- Independent review verified corrected parent references, alias/canonical URL
  collision rejection, and allowed same-owner alias convergence.
- Typecheck, build, all 24 OpenSpec validation items, and diff checks passed.
- A full transformation of the already acquired Census files emitted 59,981
  locations and matching geometry keys. No acquisition or source-file writes
  occurred.
- A one-time workspace migration replaced 59,981 path-keyed mappings with
  geography-type-plus-GEOID mappings, retaining every canonical ID. It created
  35,254 missing reverse records from the verified forward mappings. Old path
  mappings were removed after read-back verification; no runtime compatibility
  path was added.
- The four approved name corrections were unchanged. Buckeye's geometry
  correction moved to `place:GEOID:0407940`, preserving its values, condition,
  timestamp, command ID, and history.
- A subsequent full-data generation check used the migrated ledger with ID
  creation disabled and an empty database adapter. It confirmed all 59,981 IDs
  and URLs, all 1,456 aliases and targets, matching geometry keys, and zero URL
  ownership conflicts. Buckeye's existing correction still matched and applied.
- No database reset, mutation application, or direct database write was performed.

Durable evidence is in the workspace:
`audits/census-geoid-keys-20260925/` (`identity-migration.json`, `summary.json`,
and `generation-verification.json`). The artifact path is recorded in the summary.

## Earlier validation

The earlier 487-test run and `audits/census-place-corrections-20260925/`
checked the initial place separation and corrections. That implementation's
Census transform hook was rejected and removed; it is not the final design.
Subsequent removal of township clipping and the civil-case ordering fix are
documented in their respective changes' verification records.
