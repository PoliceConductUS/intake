# Manual Authority Plan

Website controller coordinates this bounded intake dependency in the existing redesign-config-driven-intake worktree; user explicitly requested no additional worktree. Use test-driven-development and review.

- [x] Test acquire/transform of LicensingAuthority through real manual chain, including required field failure.
- [x] Add one handled kind and rerun focused tests.
- [x] Acquire verified missing records using normal CLI; transform/generate; inspect exact mutation list; apply only the scoped entry.
- [x] Verify canonical state identity and preserved existing IDs, and repeat generation produces no diff.
