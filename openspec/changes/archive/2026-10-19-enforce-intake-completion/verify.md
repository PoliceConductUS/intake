# Verification

## Intake enforcement

Implementation commits: `277260e`, `a31e32d`, `e9fc49f`.

- Final clean tracked-code full suite: `npm test`, 139 files / 1,351 tests passed (2026-10-18, 91.79 seconds). Log `/tmp/intake-completion-final-tests.log`.
- Independent review reproduced and required fixes for operator correction compatibility, retained same-URL document associations, and source validation ordering. Round 2 approved `a31e32d`; 109 focused tests and typecheck passed.
- Independent transport review approved `e9fc49f`; 19 tests plus an isolated actual fetch/collector mapped-404 check passed.
- Lint, build and all 40 OpenSpec validations passed during implementation.
- Aggregate `npm run validate` is blocked by pre-existing formatting in `openspec/specs/mn-post-discipline-coverage/spec.md`, also reproduced at baseline. That unrelated file is unchanged.
- Actual transformation of the original incomplete 12,797-file MN snapshot rejects with `mn-post document incomplete for PB23-019`, before import; `/tmp/intake-reject-incomplete-mn.log`.

## Runtime schema boundary

The shared local DB includes two unrelated migrations absent from this branch. The actual schema generator produced only their migration-version/fingerprint changes after formatting, identical to the main checkout's pre-existing generated file. This runtime metadata is excluded from the fix commits. A full-suite run with that runtime metadata correctly failed three schema/reset checks; restoring the branch's own generated metadata produced the clean 1,351-test result above. Do not weaken those checks or manually edit fingerprints.

## Data recovery

Completed. Persistent evidence and operational scripts:
`/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev-copy/audits/mn-post-document-recovery-20261018`.

Original data retained; 34 unresolved licenses remain unresolved. Full acquisition, actual document review, canonical transformation, inspected forward mutation, chain application and publication verification completed.

## Narrative completeness correction

Commit `fb64628` requires explicit reasons for every null narrative across automated analysis, reviewed caches and document reads. Blank strings, undefined reasons, reasons on populated fields and stale analysis contracts reject. The extraction instructions include named or unnamed convictions and other stated factual bases; absence of incident detail is not absence of a factual basis. Reasons make the assessment reviewable; they do not prove semantic accuracy.

- Full final suite: 141 files / 1,373 tests passed, 113.87 seconds; `/tmp/intake-null-reason-full-tests.log`.
- Independent focused review: 106 tests passed, no unresolved blockers; `.superpowers/sdd/plan/null-reason-review.md` (copied to persistent audit before worktree cleanup).
- Lint, build and all 40 OpenSpec checks passed. Aggregate validation still stops only on the pre-existing formatting issue described above; `/tmp/intake-null-reason-validate.log`.
- Full source acquisition and normal registered acquisition succeeded with 531 document URLs / 530 unique reviewed PDFs; nothing skipped. The 34 unresolved licenses, resolved personnel identities and all PDF bytes are unchanged.
- Independent blank-field audits corrected 59 omitted allegation bases and two violation fields. All remaining null fields have reviewed absence reasons. Root reread all 11 supplied pages of the five documents still lacking substantive allegation facts.
- Regenerated canonical delta contains 532 existing-record updates and 2,171 sets limited to the five narratives. All source identity checks match baseline; no populated narrative is cleared. Expected coverage: 527 allegations, 472 violations, 532 findings, 117 employer actions, 532 sanctions. Application and release verification are recorded below.

## Applied data

Entry `000020-mn-post.DatabaseMutations.yaml` applied successfully: 532 mutations. Independent database comparison confirms every expected narrative, unchanged non-narrative discipline fields, all 531 personnel identities/slugs, and Minneapolis's 679 roster members / 13 with discipline. Actual narrative coverage matches the inspected delta. Evidence: `chain-apply-v2.log` and `applied-data-verification.json` in the persistent audit. Full chain verification passed for all 20 applied entries; `chain-after-apply-v2.log`.

The user's integration order requires merge/cleanup before production build. Final release checks and archive follow publication; website source remains unchanged on main `64f4e2188a010c24b1183a2c427b2ede4a26783b`.

## Integration and built-page verification

Intake main was fast-forwarded and pushed through `9fa9053`; the fix worktree and branch were removed before invoking website `npm run deploy:prod` from main. Unrelated main-checkout files and the pre-existing Oregon chain worktree were preserved.

All 13 generated Minneapolis discipline profiles match every reviewed narrative exactly. The built roster has 679 personnel and 13 discipline-filter matches; `built-verification.json`. Build validation found no inline CSS in 190,992 HTML files. Redirect coverage accounts for all 190,979 prior URLs with no route removals. The 2,490 removed deployment files are exclusively replaced Pagefind assets.

## Production release

Completed 2026-10-19 from unchanged website main `64f4e2188a010c24b1183a2c427b2ede4a26783b`. The full production build passed; 3,832 files uploaded and 2,490 replaced Pagefind assets removed. The initial deployment stopped on a temporary connection failure while listing the CloudFront redirect store. Only the remaining standard steps were retried: redirect synchronization (0 removed / 0 updated), wildcard invalidation, and deployment-manifest recording. Invalidation `IAWHGEPX6BU28E06SRIGI9PCGX` completed successfully.

Fresh public HTTP checks verified all 13 Minneapolis discipline records against every expected narrative. A headless browser check verified the live roster starts with 679 visible personnel, selecting “With discipline actions” shows 13 and “Showing 13 of 679,” and clearing the filter restores 679. Evidence: `production-deploy.log`, `production-deploy-resume.log`, `published-verification.json` and `live-filter-verification.json` in the persistent audit. No website source change was required.
