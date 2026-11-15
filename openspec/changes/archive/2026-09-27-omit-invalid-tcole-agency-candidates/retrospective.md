# Retrospective: omit-invalid-tcole-agency-candidates

Written 2026-09-27 after verification completed with documented warnings.

## 0. Evidence

Two implementation commits, 98a71c5 and 7b4e2ea: 12 files, 330 insertions, 22 deletions. Four tasks complete. Two implementation/review agent roles supported the shared validation work. Active hours were not measured. No dependencies were added. Nothing was merged, pushed, or deployed.

The source/schema subset passed 319 tests. The full suite passed 880 tests and timed out once; the unchanged seed-display file passed both tests separately. Typecheck, build, formatting, diff checks, and all 28 OpenSpec items passed. Local entry 000012 applied four inserts. Post-application checks found no lost records, URL changes, or FK orphans. See verify.md and the workspace audit report.

## 1. Wins

Canonical field validators cover every agency source and mutation boundary. Optional artifact fields and required create fields remain distinct. Source validation explains 51 of 55 manual exclusions without deleting curation or raw evidence.

## 2. Misses

The full suite ran alongside a large regeneration and one unchanged seed-scanning test exceeded five seconds. Its isolated rerun passed; no timeout or test implementation was changed. One existing Minnesota nine-digit ZIP fails the new contract; a correction from an invalid old value needs a separate contract decision.

## 3. Plan deviations

The user expanded the null-invalid source fix to shared placeholder and postal validation after inspecting raw export values. The earlier dry generation was stopped, and artifacts were regenerated under the approved contract before any data was applied.

## 4. Workflow compliance

OpenSpec was updated before each behavior change. The existing isolated worktree was reused. Red-green regressions, independent review, and live delta auditing preceded application. The unavailable openspec-verify-change skill was replaced by its schema-prescribed checks. Branch integration remains outside this task.

## 5. Surprises

Department 141134 is marked INACTIVE in the export but has a null-ended assignment. The accepted graph rule therefore admits its agency, assignment, and phones. This demonstrates why source department status and root eligibility are different facts.

## 6. Follow-up

The user subsequently requested preserving reported agency status and displaying it on the site with a supported date. That is a separate data-contract/site change; it does not change these validation or inclusion rules. Date semantics are being clarified. No memory files were modified.
