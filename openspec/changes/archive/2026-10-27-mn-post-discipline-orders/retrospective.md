# Retrospective: mn-post-discipline-orders

> Written: 2026-09-28 (after verification passed)
> Commit range: `f1e612deff7d3ff50640f283118df97c27951cbf..321a976`
> Worktree: `/Users/dalelotts/dev/PoliceConductUS/intake/.worktrees/redesign-config-driven-intake`

---

## 0. Evidence

- **Commit range**: `f1e612d..321a976` (15 commits)
- **Diff size**: +2,475 / -140 lines across 34 files
- **Tasks done**: 16/16
- **Active hours**: approximately 1.5 hours of observed implementation and full-source runs
- **Subagent dispatches**: 8 agents visible in the retained task context; this may not include earlier completed agents
- **New external dependencies**: none
- **Bugs encountered post-merge**: not applicable; PR #59 is open and the branch is not merged
- **OpenSpec validate state at archive**: pass, 30 items
- **Test coverage signal**: 944 tests across 125 files passed after final runtime changes

Commit chain (chronological):

```
9482ec1 docs: specify person-level discipline and education import
ac6447f feat: attach discipline and education to personnel
2b73c76 fix: reject conflicting discipline personnel history
2c2aa60 feat(mn-post): transform personnel discipline and education
0d3ca4b test: align discipline fixtures with required identities
63a8076 style: format personnel detail migration SQL
70aa863 docs: record MN POST review and import validation
bc5b102 fix: bound record admission to existing read coalescing
5f19cd2 revert: remove fixed-size resolution scheduling
874edd5 fix(import): reuse context-owned resolver backends
21e64ee docs: record measured intake memory failures
2c1a4d0 fix: chain record resolution in lazy batches
c4d280b docs: specify and verify chained resolution batches
af86354 fix(import): reuse immutable facade configuration
321a976 docs: record completed MN POST import and memory verification
```

## 1. Wins

- The local import added 1,769,990 education rows and updated all 76 discipline rows; the audit confirmed zero orphan references and preservation of existing IDs and slugs (`post-import-audit.json`).
- Instrumented full-source generation and the unchanged-source rerun both completed within the normal 12 GiB limit. The latter emitted zero mutations and wrote zero new identities (`memory-noop-kind-reuse-summary.json`).
- Focused fixed-heap regressions reproduced and then caught both facade-construction and resolution-pressure failures; the final full suite passed 944 tests (`tests-after-kind-reuse.log`).
- Existing tick coalescing and recurring-identity convergence were retained while resolution moved to lazy 1,000-record promise-chain batches (`2c1a4d0`).

## 2. Misses

- 🟡 [painful | commits `bc5b102`, `5f19cd2`; `memory-diagnosis.md`] An early fixed-size scheduling change preceded the requested ADR review and was reverted. Later full-source evidence justified batching with the existing coalescer.
- 🟡 [painful | `memory-noop-chained-failure.log`] The first full import passed but the unchanged-source rerun still exhausted the heap. A second measured correction was needed to share immutable per-kind facade configuration.
- 📌 [nit | `audit-live-import.mjs`] The first foreign-key audit query returned PostgreSQL `name[]` as text. Casting aggregated attribute names to `text` fixed the audit; the import itself was unaffected.

## 3. Plan deviations

| Plan task | What changed                                                                                                                                           | Why                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.5       | Added promise-chain batching after the initial graph-resolution OOM; the first 64-record attempt was reverted.                                         | ADR review established that same-tick coalescing did not bound how quickly whole-kind `Promise.all` started resolver work. Controlled probes measured the pending-work cost. |
| 5.6       | Added immutable per-kind configuration reuse after the initial bounded-batch import succeeded but a no-op rerun failed during existing-row comparison. | A controlled 100,000-facade experiment showed roughly 167 MiB saved by sharing kind-derived columns, resolvers, and mutation constructors while preserving per-record state. |

## 4. Skill / workflow compliance

| Skill                                      | Used |
| ------------------------------------------ | ---- |
| superpowers:brainstorming                  | ✓    |
| superpowers:writing-plans                  | ✓    |
| superpowers:using-git-worktrees            | ✓    |
| superpowers:subagent-driven-development    | ✓    |
| superpowers:test-driven-development        | ✓    |
| superpowers:requesting-code-review         | ✓    |
| superpowers:finishing-a-development-branch | ✓    |

### Deliberately Skipped Skills

(none)

## 5. Surprises

- The 1.77 million education records exposed shared pipeline allocation costs that did not appear in ordinary-sized source imports; construction, pending identity work, and existing-row comparison each had separate heap behavior.
- Bounding pending work was necessary but insufficient. Sharing immutable kind configuration was also necessary for the unchanged-source comparison to fit under the normal heap limit.
- No new dependency or database preload was needed; the existing coalescer and persisted source identity ledger handled the import.

## 6. Promote candidates → long-term learning

- [ ] 🟡 **Large-source admission tests should cover full retained-work phases, not only pending promises.** → **Promote to memory** (type: feedback)
  > **Why**: The bounded-batch import passed, while its unchanged-source comparison still exhausted the heap until duplicated facade configuration was removed.
  > **How to apply**: When a source has hundreds of thousands of records, measure construction, pending resolution, mutation comparison, and rerun behavior under a fixed heap.
