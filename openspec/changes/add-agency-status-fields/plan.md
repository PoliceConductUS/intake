# Agency Status Fields Implementation Plan

> Use the existing OpenSpec/Superpowers subagent execution and review workflow.

**Goal:** Preserve nullable agency status and status_date from TCOLE.
**Architecture:** Two additive columns feed schema-generated contracts and the existing import pipeline. No new audit/event layer or viewer work.
**Tech Stack:** PostgreSQL, TypeScript, Zod, Vitest.
**Spec:** specs/agency-status/spec.md and design.md.

## Constraints

Both columns nullable. Use the approved DATE_OFFICIAL interpretation. Preserve identities, URLs, existing rows, and graph selection. No viewer edits, triggers, audit/event additions, dependencies, or database reset outside disposable tests.

## 1. Schema and source

- [x] Add failing regressions in test/sources/gov.tx.tcole.test.ts for INACTIVE with a date and with a null date; canonical Agency contracts must accept both.
- [x] Add supabase/migrations/20260927000000_agency_status.sql with `alter table public.agency add column status text, add column status_date date` and the existing nullable nonblank status constraint pattern.
- [x] Test the migration against disposable PostgreSQL: existing rows get nulls; INACTIVE with null date and a dated status update both persist.
- [x] Regenerate contracts with scripts/generate-envelope-types.ts against the migrated schema. Modify sources/gov.tx.tcole/transform.ts to read DATE_OFFICIAL and emit status plus nullable date through AgencySpec.
- [x] Run focused source/schema and real database update tests, typecheck, build, and formatting; review the implementation.

## 2. MN POST source check

- [x] Inspect MN POST acquired agency inputs for explicit agency status/date fields. Map them if present; do not infer agency status from personnel licensing status or roster membership. Document the evidence if the source supplies neither.

## 3. Local application and verification

- [ ] Apply the additive migration locally without reset; regenerate TCOLE Artifacts and the mutation delta.
- [ ] Inspect the delta: status/status_date updates only, no ID/slug changes or deletions. Apply the reviewed entry.
- [ ] Confirm department 141134 has INACTIVE and 2004-01-07; verify records/URLs/FKs and applied entries.
- [ ] Record verification and retrospective, sync the spec, and archive. Do not touch the viewer.
