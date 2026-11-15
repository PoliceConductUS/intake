# Verification report

Current production agency reconciliation, 2026-09-27.

## Scope and evidence

Evidence root: `/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev-copy/audits/reconcile-production-20260927/`.

This is a data correction and rebuild from saved acquired inputs, not fresh acquisition or full production parity. Production membership comes from the fresh sitemap; local before/after snapshots establish retained identity and relationship stability. No viewer code, runtime pipeline code, schema, or deployment was changed.

## Checks

- Canonical root correction: exactly 16 additions, original 2,932 roots retained; independent review passed.
- Four federal forward/reverse mapping pairs now use selected TCOLE Agency identities; survivor slug caches unchanged; independent review passed.
- Targeted existing tests: four files, 24 tests passed. OpenSpec validation: 30 passed, zero failed.
- Reset initially exited 1 on the federal Census geocoder timeout. Exact failed-command retry exited 0; all seven remaining continuation commands exited 0. `rebuild-completion.json` preserves this distinction. No failed source was skipped.
- Existing local projection refresh exited 0; 4,883 payloads, 3,198 agency ZIP index rows, 4,692 closure rows. No projection generator code was changed.
- Data verification exited 0; all eight mutation entries applied and checksums verified.
- Final snapshot: 3,292 agencies (+16), 140,548 personnel (+35), 181,675 assignments (+50), 5,449 phone rows (+15), 163,596 licenses (+35), 188,003 license actions (+91).
- No removed records, retained identity/slug/path changes, or non-timestamp retained entity/relationship field changes. Mutation-ledger checksums differ as expected after rebuild.
- All 59,981 geometry row hashes retained exactly. Projection closure gained 18 rows, removed zero.
- All 43 foreign-key checks show zero orphans. All 181 exact restored-source/identity/field checks passed.
- Three retired Texas duplicate IDs/slugs and their references absent; selected survivors unchanged. Four deferred Minnesota identities unchanged.
- Production agency path comparison: 2,997 production, 3,292 local, 2,898 shared, 99 production-only, 394 local-only. Each production-only path has an explicit disposition; unresolved source/identity/selection gaps remain unresolved.

## Limits and completion

The later federal source updates the four selected agencies using its ordinary field precedence. Their canonical IDs/slugs and TCOLE status/status_date are retained; full source field comparisons are in `comparison/federal-survivor-check.json`.

Audit narrative and machine-readable assertions are complete in `report.md` and `final-validation.json`. Final independent review found no blocking issues; see `independent-final-review/report.md`. Overall decision: PASS for the scoped data correction and local preservation audit, with the stated source/production gaps unresolved. No production database snapshot was available, so this does not prove production relationship parity or present-day source freshness.

Source-data finding: FBI and Secret Service raw date-formatted Excel cells contain serial 1, which the existing reader emits as 1899-12-31. Authentic official-date meaning is unverified; this scoped correction does not reinterpret those dates. The later federal source also clears existing contact names; ordinary source precedence is documented in the audit.
