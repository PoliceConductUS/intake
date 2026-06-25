# Retrospective: import-manifest-to-database

> Written: 2026-06-08 (after verify passed)
> Commit range: `e2ec2b5..d8cf6d1`
> Worktree: `/Users/dalelotts/dev/PoliceConductUS/intake/.worktrees/import-manifest-to-database`

---

## 0. Evidence

- **Commit range**: `e2ec2b5..d8cf6d1` (14 commits at retrospective write time)
- **Diff size**: 3,042 insertions / 3 deletions across 22 files
- **Tasks done**: 19/19
- **Active hours**: ~1.2 apply hours from first baseline test to verify commit
- **Subagent dispatches**: 24 implementation/review dispatches
- **New external dependencies**:
  - `yaml@2.9.0` — ISC
  - `@paralleldrive/cuid2@3.3.0` — MIT
  - `pg@8.21.0` — MIT
  - `@types/pg@8.20.0` — MIT
- **Bugs encountered post-merge**: none; branch not merged
- **OpenSpec validate state at archive**: pass before archive (`npm run openspec:validate`: 2 passed, 0 failed)
- **Test coverage signal**:
  - `npm test`: 6 files, 49 tests passed
  - `npm run typecheck`: passed
  - `npm run build`: passed
  - `npm run supabase:reset`: passed
  - final whole-change review: approved, no blocking findings

Commit chain:

```text
2ca8474 feat(cli): route manifest import command
cbefca8 feat(import): validate import package manifests
29d024b feat(import): resolve source-key mappings
006abd3 fix(import): preserve source mapping persistence path
5d3b464 feat(import): transform manifest entities
ff335cc fix(import): validate required manifest row fields
2c2fd7a feat(import): write manifest rows to database
5108351 test(import): cover database writer rollback failures
91df027 test(import): keep transform regression helper typed
ad04854 feat(import): seed mn post source mappings
056c2b5 test(import): assert exact mn post seed mappings
26fae7d test(cli): expect database-url import boundary
4813423 chore(openspec): add manifest import change artifacts
d8cf6d1 chore(openspec): verify manifest import change
```

---

## 1. Wins

- The staged subagent/review loop caught real quality gaps before final validation: mapping path metadata loss was fixed in `006abd3`, required source-owned DB fields were made fail-fast in `ff335cc`, and actual writer rollback coverage was added in `5108351`.
- The implementation stayed aligned with the project’s fail-loud posture: `src/import/database.ts` uses direct transactional inserts and the final review found no `ON CONFLICT`, `DO NOTHING`, or upsert behavior.
- Validation covered both code and seed/schema risk: `npm test`, `npm run typecheck`, `npm run build`, `npm run openspec:validate`, and `npm run supabase:reset` all passed before verify.
- The initial MN POST source mapping is checked in as data, not a generator feature, and `test/source-mappings.test.ts` asserts the known seed mappings exactly after `056c2b5`.

## 2. Misses

- 🟡 [painful] Task 5’s first database writer test suite did not exercise the real insert-failure path; spec review caught it and `5108351` added rollback/constraint failure coverage.
- 🟡 [painful] Task 4 initially allowed required DB fields to become `null`; code-quality review caught the fail-fast gap and `ff335cc` added required source field validation.
- 📌 [nit] The Task 6 integrity test initially used `toMatchObject`, which was too permissive for exact mapping data; `056c2b5` tightened it to exact selected-entry equality.
- 📌 [nit] Adding `$INTAKE_WORKSPACE/intake/sources/mn-post/` changed the expected CLI failure boundary from missing mapping file to missing `DATABASE_URL`; `26fae7d` updated the stale test assertion.

## 3. Plan Deviations

| Plan task                    | What changed                                                                                   | Why                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Task 2 / Task 3 dependencies | `yaml` was installed during manifest parsing instead of waiting for mapping work.              | Manifest parsing needed YAML support before Task 3; version was checked first (`yaml@2.9.0`).                  |
| Task 4                       | Added required source-owned field validation beyond the original transformation test examples. | DB `NOT NULL` columns made null projection unsafe; review found this before final validation.                  |
| Task 5                       | Added an extra targeted writer rollback test commit.                                           | Initial coverage tested the pipeline failure surface but not the actual `writeImportRows` insert-failure path. |
| Task 7                       | Added two test-only follow-up commits before final validation.                                 | Full validation exposed a TypeScript helper issue and a stale CLI failure-boundary assertion.                  |

## 4. Skill / Workflow Compliance

| Skill                                            | Used                  |
| ------------------------------------------------ | --------------------- |
| superpowers:brainstorming                        | ✓                     |
| superpowers:writing-plans                        | ✓                     |
| superpowers:using-git-worktrees                  | ✓                     |
| superpowers:subagent-driven-development          | ✓                     |
| (transitive) superpowers:test-driven-development | ✓                     |
| (transitive) superpowers:requesting-code-review  | ✓                     |
| superpowers:finishing-a-development-branch       | Pending after archive |

### Deliberately Skipped Skills

- None. `superpowers:finishing-a-development-branch` is not skipped; the schema orders it after retrospective and archive, so it is pending at retrospective write time.

## 5. Surprises

- The generated plan placed `yaml` under mapping dependencies, but manifest parsing needed it earlier.
- The checked-in source mapping file changed the CLI test’s expected failure boundary because a valid manifest could now proceed past mapping load.
- The schema asks the retrospective to report finishing-skill compliance before the point where finishing is supposed to run.

## 6. Promote Candidates → Long-Term Learning

- [ ] 🟡 **When adding setup data, re-check tests that previously asserted absence-state failures.** → **Promote to memory**

  > **Why**: `$INTAKE_WORKSPACE/intake/sources/mn-post/` made the valid CLI manifest route advance from mapping-file failure to missing `DATABASE_URL`, requiring `26fae7d`.
  > **How to apply**: After adding a fixture, mapping file, seed row, or config file, rerun and inspect tests that expected missing-file or missing-data failures.

- [ ] 🟡 **Database writer tests must exercise the real writer failure path, not only injected pipeline failures.** → **Promote to memory**

  > **Why**: Task 5 initially passed while rollback behavior was not covered; `5108351` added actual `writeImportRows` insert-failure coverage.
  > **How to apply**: For database import/write tasks, include one fake-client failure that occurs inside the concrete writer loop and assert rollback/close/error behavior.

- [ ] 📌 **Retrospective schema should distinguish pending post-archive finishing from skipped finishing.** → **Promote to schema**
  > **Why**: The retrospective is required before archive, while `superpowers:finishing-a-development-branch` is explicitly ordered after archive.
  > **How to apply**: Update the retrospective template or instruction to allow a `Pending by schema order` status for finishing-phase skills that occur after retrospective creation.
