# Implementation plan

1. Add failing unit regressions in test/import/entity-facade.test.ts and relevant cache/slug tests for unchanged canonical identity, source slug rejection, name correction, database/cache disagreement, and reset reuse.
2. Update src/cli/import/artifacts/facades/ and allocator using existing canonical cache adapters. Preserve unrelated property behavior. Run focused Vitest files after each change.
3. Add replay immutable-field regression coverage and implement the minimum guard in src/cli/replay/database-mutations/execute.ts.
4. Independently add test/import/slug-preservation.integration.test.ts using startIntakeDatabase, actual import/replay entrypoints, and real canonical IO. Demonstrate preserved IDs/slugs through update/reset and transactional rejection of URL changes.
5. Run TypeScript checks, relevant import/replay tests, npm run openspec:validate; independently review the diff and fix findings. Record verification, sync the new spec, archive the change, and commit only this change in the existing redesign worktree.
