# Retrospective: bootstrap-tcole-agency-roots

Written September 27, 2026 after verification passed.

## 0. Evidence

Implementation commit `929feeb`: 18 files, +718/-4. Five tasks complete. Existing isolated redesign-config-driven-intake worktree retained. Three agents handled implementation, independent review, and audit; follow-up turns closed the review gap. No dependencies added. Full suite: 907 tests/122 files; final targeted suites: 30 tests/four files. Typecheck/build/format and OpenSpec 30/30 passed. Reset completed in approximately 23 minutes. Eight mutation entries verify; all 43 foreign-key checks pass. No merge occurred.

## 1. Wins

Exact live sitemap slugs and persisted source mappings established the requested root list without guessed identities. The reset restored exactly the 122 expected agencies and their reachable records. Empty-table gating was tested with reference rows already present and with an unrelated agency preventing bootstrap.

## 2. Misses

Review caught an inadequate invalid/excluded test: its named roots were only absent candidates. The final fixture exercises the actual TCOLE validation and shared exclusion cascade before import. Review and targeted tests passed after correction.

## 3. Plan deviations

Existing forward source mappings were read using known workbook source IDs because legacy reverse mappings were absent. No mapping was created or repaired by this audit. The optional post-reset list was determined from the live production sitemap as the user requested. Production code remained unchanged during the full rebuild; the review follow-up changed only tests.

## 4. Skill and workflow compliance

The agreed user requirements and OpenSpec brainstorm/design/plan preceded code. The existing isolated worktree was reused. Subagent implementation followed TDD, followed by independent review and fresh verification. OpenSpec apply/archive and verification discipline were used. Branch finishing retains this continuing worktree and its commits without integration.

### Deliberately skipped substeps

A fresh worktree and a merge/PR selection prompt were not needed for this continuation of the existing authorized implementation branch. No integration was requested. Scope rule for this cycle: keep the existing branch and workspace intact and complete the requested implementation/audit; integration remains a separate user decision.

## 5. Surprises

The published sitemap includes five agency identities without an eligible distinct TCOLE mapping, all documented exclusions or previously approved duplicate omissions. Fifty of the 2,932 mapped source names remain invalid or explicitly excluded. The root list does not override those rules. After restoration, the 27 remaining original-local agency omissions all have federal addresses outside TX.

## 6. Promote candidates

None. Evidence and findings remain in this change and the audit; no memory update was requested.
