# Verification, 2026-09-27

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

## In progress

- Full test rerun passed: 123 files, 933 tests. The five old discipline
  fixtures were updated for required references; the isolated PostgreSQL test
  now follows the existing 60-second setup timeout and cleanup convention.
- Initial live generation exhausted the 12 GB CLI heap before data apply.
  Same CLI pipeline restarted with an explicit 32 GB heap; result pending.
- Live data generate/up and post-import identity/count/rerun audit remain pending.
- No full legacy linked seed load was performed. Migration history and dedicated
  real-database fixtures were exercised; no seed records were added or edited.

Operational evidence: `$INTAKE_WORKSPACE/audits/mn-post-details-20260927/`.
