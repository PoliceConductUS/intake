# Verification

- The two mapped-source regressions failed before the resolver change: each
  returned the court:docket ID and a generated slug instead of the mapped
  production ID and cached published slug.
- 152 targeted tests pass, covering both producers, same-context convergence,
  retained IDs/slugs, dependent references, unmapped natural IDs and suffixes.
- Typecheck, build, OpenSpec validation (21 items), formatting and diff checks pass.
- Read-only verification with the actual 466-case CourtListener artifact and
  workspace mappings/cache resolves six original case IDs/slugs, 14 personnel
  references and six case links. All other 460 case IDs/slugs remain unchanged.
- Corrections reside only in durable workspace mappings/cache. No case-specific
  IDs or conditions were added to importer code. The local database is unchanged;
  the next normal reset/generation uses these corrections. No acquisition is needed.
- Existing applied mutation history is unchanged. Replaying that old history alone
  is not regeneration and will not incorporate the corrected mappings.
- Workspace evidence: `audits/rebuild-followup-20260923/civil-cases/`.

## 2026-09-25: Asynchronous identity lookup ordering

The grouping step appended facades as their identity lookups completed, reversing
same-case updates when an earlier registered record resolved later. The existing
two-producer regression now resolves the later case identity first; both producer
variants failed before the fix with the summary update reversed.

Identity lookups remain concurrent. Grouping consumes their results in registration
order, preserving the existing create-then-update behavior. Both regression
variants now pass. The broader targeted suite passed 487 tests across 50 files;
typecheck, build, all 24 OpenSpec items, and diff checks passed. No database changes
or reset were performed.
