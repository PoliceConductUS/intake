# Retrospective: select-agency-reachable-records

Written 2026-09-26 after verification passed. Implementation range: b6bd73e..7973f0d. Worktree: .worktrees/redesign-config-driven-intake.

## 0. Evidence

- One implementation commit: 7973f0d, feat(intake): select records through qualifying agency roots.
- Implementation diff: 22 files, 1819 insertions, 61 deletions.
- Tasks: 7/7 complete.
- Active hours: not measured.
- Four implementation/review agent roles; repeated followups were not separately tallied.
- No new external dependencies. Not merged or deployed; post-merge results are not applicable.
- OpenSpec: 27/27 validations passed before archive.
- Full suite: 119 files, 861 tests passed in 212.96 seconds with two workers.
- Verification details and exact commands: verify.md.

## 1. Wins

- Shared graph metadata keeps source-specific eligibility rules out of the import policy.
- Closing-state integration proves both factual updates and stored identity preservation across two consecutive imports.
- Reader regressions caught incomplete before/after graph loading before delivery.

## 2. Misses

- The initial selector would have filtered the update ending an agency's last open assignment. The user clarified both permanent retention and root admission for that closing dataset; tests now encode both.
- The first full run encountered database contention and fixtures without qualifying assignments. Focused runs separated environment failures from fixture gaps; the final complete run passed.

## 3. Plan deviations

- Root eligibility expanded from open assignments to the union with case-connected agencies at the user's direction.
- Admission uses both stored and incoming snapshots so the last-assignment closure is processed with its agency descendants.
- MN required only a stronger assertion; its transform already emitted explicit null end dates.
- Candidate-aware CourtListener lookup was considered, then excluded after the user expressly accepted pre-query agency filtering.

## 4. Workflow compliance

Brainstorming and planning artifacts preceded implementation. The existing isolated worktree was reused and its seed link checked. Subagent implementation/review, red-green tests, systematic debugging, and verification were used. Review found no remaining blocker. Archive synchronizes the accepted behavior into the durable specification.

### Deliberately skipped steps

The named openspec-verify-change skill was unavailable in the installed catalogs. Its explicit schema checks were performed and recorded in verify.md. Future runs should check skill availability at workflow entry. Branch integration is deferred because the request authorized implementation; no merge, push, or PR was requested.

## 5. Surprises

An effective-state-only selector cannot process the dataset that ends the final qualifying assignment correctly. Eligibility for that import needs the stored roots too. Retaining stored records is a separate step and must not become a traversal root for new records.

## 6. Long-term learning

The accepted no-deletion invariant, before/after root rule, and CourtListener boundary are captured in the capability specification. No memory files or unrelated workflow configuration were modified.
