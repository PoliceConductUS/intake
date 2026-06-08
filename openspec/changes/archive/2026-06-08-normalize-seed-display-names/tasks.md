## 1. Regression Coverage

- [x] 1.1 Add a focused seed display-name test that fails on all-caps phrase values in agency and federal agency seed inserts.
- [x] 1.2 Run the focused test and confirm it fails against the current seed data.

## 2. Seed Normalization

- [x] 2.1 Normalize reader-facing all-caps agency names in `supabase/seed.sql` while preserving IDs, slugs, URLs, acronyms, source titles, and relationships.
- [x] 2.2 Normalize project-authored coverage/provenance note references that repeat the same all-caps agency names.
- [x] 2.3 Run the focused test and confirm it passes.

## 3. Validation

- [x] 3.1 Run `npm test`.
- [x] 3.2 Run `npm run openspec:validate`.
- [x] 3.3 Run Supabase seed/reset validation if available; if it cannot run, report the reason. `npm run supabase:reset` reached seed loading and failed because this worktree lacks the untracked `location_report_sources` migration present in the main checkout.
