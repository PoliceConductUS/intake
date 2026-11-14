# Retrospective: restore-oregon-roster-personnel

Written 2026-11-14, after implementation verification passed.
Worktree: `.worktrees/agent-guardrails`, branch `chore/agent-guardrails`.

## 0. Evidence

- Implementation range: `24009b96d21deb5b035f06b2a6a880f3aaa953a0..31a202e3a62e4890bb0317d0359ea3e0dc19c149`; four commits for this change. The reused PR branch also contains earlier work.
- Implementation diff: +1453 / -150 lines across 26 files.
- Tasks: 5/5 complete.
- Active hours: not instrumented.
- Subagents: eight distinct implementation, design and review agents recorded across the cycle; follow-up turns are not counted separately.
- New external dependencies: none.
- Post-merge bugs: this change is not yet merged.
- OpenSpec: 51/51 valid before archive; archive sync and final-head validation follow.
- Validation: 184 test files, 1,917 tests, zero skips; all implementation-head CI checks passed.
- Data outcome: 2,888 original personnel IDs/slugs restored; 160,239 prior personnel paths accounted for in the local database.

```text
cf15990 fix(oregon): retain roster personnel without certificates
f87d030 fix(intake): condition exclusions on source values
7dc66a9 fix(intake): read exclusion contents and permissions together
31a202e test: allow generated-file comparison to complete in CI
```

## 1. Wins

- The certificate correction removes only the source predicate; its regression tests retain real supplied credentials and employment without inventing licenses.
- Source-field conditions preserve the unrelated unconditional exclusion and let acquired corrected values pass normal validation.
- Real-source mutations preserve established identities and URLs. Independent reviews and CI exposed shared batch, writer and integration-test issues before merge.

## 2. Misses

- Painful: a one-off name correction was started during diagnosis. It was removed before any database application, and its temporary cleanup interface was withdrawn. The delivered change uses source code and acquired values.
- Painful: the first shared implementation overlooked streamed records and overlapping file updates. Review reproductions led to canonical bounded filtering and atomic publication.
- Painful: atomic replacement initially changed file permissions; CI then exposed a separate path stat/read race. Permission and file-handle regressions now cover these cases.
- Painful: the generated-file comparison inherited a five-second unit-test budget. Its measured CI workload exceeded that budget; the test retains every comparison under its own finite integration budget.

## 3. Plan deviations

| Area                | Final change                                                              | Reason                                                                          |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Temporary exclusion | Add explicit source-field conditions to the existing operation            | User approved conditions tied to the problematic source values                  |
| Shared transform    | Include emitted records and dependent removals                            | Generic source conditions must work for all currently supported outputs         |
| Shared writer       | Coordinate writes, publish atomically and preserve mode/content coherence | Reproduced loss, partial reads, permission change and CodeQL finding            |
| Integration check   | Give the comparison body 30 seconds                                       | Its actual formatting workload exceeded the unit default; coverage stays intact |

## 4. Workflow compliance

| Workflow                   | Applied                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------ |
| Brainstorming and planning | Approved outcomes recorded before implementation                                     |
| Worktree setup             | Reused the existing linked worktree; created no branch or worktree                   |
| Subagent implementation    | Serial implementation with task reviews and aggregate review                         |
| Tests first                | Recorded failing regressions before each behavior correction                         |
| Code review                | Independent task, aggregate and scoped correction reviews                            |
| Verification               | Full local gates, actual CI and read-only identity/path checks                       |
| Branch finish              | Existing PR workflow; final archive-head CI and named merge approval remain required |

The user’s direct instruction to fix problems found took precedence over stopping at a review-round limit while a new regression remained. No assertion, rule or coverage was waived.

## 5. Surprises

- Inline-only exclusion handling did not cover emitted geometry records even though the source declared that output.
- Reading file permissions by path separately from contents was not one coherent input snapshot.
- Local success did not expose the CI comparison-budget limit; the real CI result supplied that evidence.

## 6. Promotion candidates

None proposed. Existing repository scope, canonical IO and verification instructions already cover the lessons above; no memory or new standing rule is added.
