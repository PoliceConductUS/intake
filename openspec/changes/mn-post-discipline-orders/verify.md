# Verification, 2026-09-27

Local import and audit are complete. Chain entry `000010` applied 1,770,086
mutations, including 1,769,990 education records and 76 discipline updates.
The final unchanged-source rerun exited successfully with zero mutations, zero
identity writes, and no new chain entry. All 944 tests pass.

## Completed

- Person/issuer migration exercised against real isolated PostGIS with retained
  action/link IDs, required references, ambiguous/missing/mismatched historical
  identity rollback, and education validation. Schema/graph/IO tests: 70 passed;
  strengthened migration regression: 14 passed. Typecheck/build passed.
- MN POST transform: 38 tests passed, including two licenses/multiple assignments,
  person-level actions without assignment/license, duplicate-case evidence,
  education identity, null fields, and three reported unnamed omissions.
- Independent schema and source reviews passed after fixing assignment/license
  person disagreement detection in migration.
- Reviewed migration applied incrementally to local 127.0.0.1:54322. Pre-import
  backup saved; all 3,292 agencies, 140,548 personnel, 76 actions, 83 historical
  action-assignment links, and two authorities retained. Existing fields and
  slugs unchanged at the post-migration checkpoint.
- Acquisition resumed successfully: 70 PDF/document records, 69 distinct PDF
  hashes reviewed by Codex, 448 supporting quotations checked against source
  page text. Seven unavailable links reported in acquisition skipped.yaml.
- Available unique orders: 69 allegations, violations, findings, and sanctions;
  40 stated employer actions. Nine source discrepancy/attachment notes preserved.
- Full source transform completed using existing 10,000-record artifact chunks.
  Source education count 1,769,993; user-approved unnamed omissions three;
  expected retained education count 1,769,990.
- OpenSpec validation: 29 passed, zero failed.

## Runtime diagnosis and live verification

- Full test rerun passed: 123 files, 933 tests. The five old discipline
  fixtures were updated for required references; the isolated PostgreSQL test
  now follows the existing 60-second setup timeout and cleanup convention.
- Initial live generation exhausted the 12 GiB CLI heap before data apply.
  Full-source instrumentation located 15.3 GiB heap during construction of
  1,803,134 facades, before any BatchLoader load or flush. Allocation sampling
  attributed about 7.9 GiB to duplicated resolver backends.
- The fixed-size resolution grouping experiment was reverted in `5f19cd2`.
  `874edd5` instead reuses context-owned backends by kind/identity column,
  preserving ADR 0016/0017 same-tick coalescing. Independent review approved.
- A 50,000-facade regression failed with heap exhaustion at 384 MiB before the
  correction and passes at about 226 MiB afterward. The full-source construction
  probe now completes at 8.2 GiB under the normal 12 GiB heap limit. It stopped
  intentionally before graph identity resolution; complete generation remains
  a separate verification.
- Full test run after backend reuse: 124 files, 936 tests passed. Typecheck,
  build, and all 30 current OpenSpec items passed. The subsequent full-source run
  failed at 12 GiB during graph identity resolution, after successful 8.2 GiB
  construction. A controlled 100,000-record probe measured about 409 MiB of
  additional pending identity work. No education identity files or database
  mutations were written.
- User-authorized promise-chain batching is implemented in `2c1a4d0`. Graph
  identity resolution, mutation identity grouping, and singleton mutation
  resolution lazily admit 1,000 records per batch. Existing tick coalescing and
  sequential recurring-identity convergence are retained. Seven regression
  tests failed on the previous whole-kind admission; all 125 focused tests now
  pass, including cross-batch convergence and the construction memory test.
  Typecheck, build, formatting, and independent review passed.
- The controlled 100,000-record graph probe now admits 1,000 pending lookups
  instead of 100,000. Additional heap at that checkpoint decreased from about
  409 MiB to 4 MiB. This establishes bounded pending work; the full-source
  generation and import audit remained separate checks.
- Full test run after chained batching: 125 files, 944 tests passed. All 30
  current OpenSpec items passed. Evidence: `tests-after-chained-batches.log`.
- Full-source generation with chained batches completed successfully under the
  normal 12 GiB heap limit (exit 0, 2,338 seconds). All 1,803,134 facades were
  processed; graph selection omitted zero records. Maximum sampled heap was
  10.568 GiB. The existing coalescer serviced 1,825,199 loads in 1,813 flushes.
  Chain entry `000010` contains 1,769,990 education creates, 76 discipline
  updates, one agency create, four personnel creates, four license creates, and
  eleven assignment creates. A canonical-IO audit confirmed all mutation counts.
- Local chain entry `000010` applied successfully. The post-import audit confirms
  1,769,990 unique education IDs for 10,553 personnel, 5,253,060 credits,
  12,822 missing completion dates, and no unnamed records. All 76 discipline
  records have person/issuer/document references; 69 have allegation, violation,
  finding, and sanction details, and 40 have stated employer actions. No
  discipline/education foreign-key orphans exist.
- All original 3,292 agency IDs/slugs, 140,548 personnel IDs/slugs, 76 discipline
  IDs, and 83 historical discipline-assignment links remain. Existing agency,
  personnel, and historical link fields are unchanged. The independent manual
  authority entry `000009` added 48 authorities during this work; MN POST entry
  `000010` did not modify authorities. All ten applied chain entries verify.
- An initial audit-script query returned PostgreSQL `name[]` as text; casting
  column names to `text` fixed the audit, which then passed. No product/data
  change was needed.
- The unchanged-source rerun reused all 1,803,058 ledger mappings with zero
  identity writes and passed graph selection with zero omissions. It then
  exhausted the 12 GiB heap during comparison of about 1.18 million existing
  rows (exit 134). This does not undo the successfully applied import. The
  correction below addresses duplicated immutable kind configuration.
- `af86354` reuses only kind-derived columns, resolver definitions, and mutation
  constructors. Per-record options, values, memoization, caches, and scheduling
  are unchanged. The strengthened 100,000-facade regression exhausted 384 MiB
  before this correction and passes at about 235 MiB afterward. All 186 focused
  tests, typecheck/build, formatting, and independent review passed.
- The final full unchanged-source rerun succeeded under the normal 12 GiB heap
  limit (exit 0, 866.8 seconds). It processed all 1,803,134 facades, reused
  1,803,058 ledger mappings with zero writes, omitted zero graph records, and
  produced zero mutations. Construction used 5.456 GiB; maximum sampled heap
  was 10.733 GiB. No chain entry was appended. All ten applied entries verify.
- Final full suite after kind-configuration reuse: 125 files, 944 tests passed.
  Evidence: `tests-after-kind-reuse.log`, `memory-noop-kind-reuse.log`, and
  `memory-noop-kind-reuse-summary.json`.
- No full legacy linked seed load was performed. Migration history and dedicated
  real-database fixtures were exercised; no seed records were added or edited.

Operational evidence: `$INTAKE_WORKSPACE/audits/mn-post-details-20260927/`.
