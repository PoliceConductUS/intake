# Preserve intake slugs implementation plan

**Goal:** Preserve IDs and published slugs during intake loading and correct demonstrated same-ID regressions.
**Spec:** specs/artifacts-database-import/spec.md
**Architecture:** Existing mapping ledger owns identity; canonical ResolvedProperty IO owns cached slugs; database values own established URLs during updates.

## Task 1: Import and replay preservation

Files: src/cli/import/artifacts/transform.ts, plan-database-mutations.ts, config.ts as necessary; src/cli/replay/database-mutations/execute.ts; relevant test files.

- [x] Confirm producer slug fields cannot assign canonical slugs; add same-ID personnel and agency preservation tests.
- [x] Add existing-row planning and replay tests where generated/source slug differs; assert database slug stays unchanged and non-slug fields update.
- [x] Run tests before implementation and record expected failures.
- [x] Preserve existing database slugs in preparation/replay and canonical cache reuse; keep source slugs non-authoritative. Do not alter ID resolution.
- [x] Run focused tests and typecheck; submit diff for independent review.

## Task 2: Exact-ID recovery

Files: bounded correction script/evidence in ignored task working directory; recovery documentation in this change.

- [x] Read reference-20260814 CSVs and current database read-only. Check duplicate IDs/slugs and exact-ID matches. Record source SHA256 and mismatch totals.
- [x] Create reviewable correction plan retaining original slug, replacement slug, canonical ID, table, and cache envelope before state. Use canonical IO for all YAML.
- [x] Apply only demonstrated exact-ID corrections to local database and cache; retain backups. Verify rows and IDs afterward. No production deployment or identity merges.

## Task 3: Review and verification

- [x] Review all changes for spec coverage and unintended scope.
- [x] Run tests, typecheck, changed-file formatting, git diff check, and npm run openspec:validate.
- [x] Record verified counts and any blocked operations in verify.md and recovery.md.
