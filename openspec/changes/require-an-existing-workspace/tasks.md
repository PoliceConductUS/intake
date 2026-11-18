## Implementation

- [x] `intakeWorkspace` in `src/cli/command-directory.ts`: fail when the path is not an existing folder; test with a missing path, a file, and a relative path that resolves to nothing.
- [x] Make tests that relied on the workspace being created create it first (`test/cli/data-exclude.test.ts`).
- [x] Give `.env.example` an absolute path. No README under `src/` on this branch describes `intakeWorkspace`, so none changes here.

Added after review of commit `6c6cc61`, with the owner's decisions of 2026-11-18 (reject relative paths; do the work now with both variables):

- [x] `intakeWorkspace`: reject a relative path, naming the variable and the value; name the variable in use when it is unset or blank; when `statSync` throws (for example EACCES), fail naming the variable and the value. Tests in `test/cli/command-directory.test.ts`: unset, blank, relative (including one that exists), missing, a file, unreadable.
- [x] `intake requests submit|status|sync` (`src/cli/requests/index.ts`): build `RequestStore` from `intakeWorkspace(process.env)`, so a missing workspace fails before `RequestStore` runs `mkdir -p`. Test in `test/requests/cli.test.ts` that each subcommand fails and the folder is not created.
- [x] `defaultChainRoot` in `src/cli/data/chain.ts`: take the workspace from `intakeWorkspace(process.env)`, so `data up`, `data status`, `data verify`, `data generate` and `data restore-identity` fail on a missing workspace instead of reading an empty chain. Unit test in `test/cli/data/chain.test.ts` that `chainDir()` and `listEntries()` fail on a missing workspace and do not create it.
- [x] `data transform` with no source (`src/cli/data/index.ts`): check the workspace with `intakeWorkspace(process.env)` before the loop, so a missing workspace fails the command instead of being listed as each source's skip. Test in `test/cli/transform/transform.integration.test.ts`. Whether other errors should still be listed as skipped is not part of this change.
- [x] `sourceLedgerRoot` in `src/cli/state/source-name-to-canonical-id/index.ts`: `rootDir` is required and there is no `process.env` fallback; the same for `restore.ts` and `seedLedgerFromIdentityMaps`. `scripts/seed-tcole-ledger.ts` passes `intakeWorkspace(process.env)`. Remove the test that expected "INTAKE_WORKSPACE is required to resolve SourceNameToCanonicalId records."; calling without `rootDir` is now a type error.
- [x] `scripts/publish-import-schemas.ts`: take the workspace from `intakeWorkspace(process.env)`.
- [x] `src/cli/import/artifacts/existing-import.ts`, `src/cli/import/artifacts/config.ts` (with `commandInput.env ?? process.env`, inside a `try` that returns the import's error), `src/cli/transform/index.ts` (only where the database transform builds its SourceNameToCanonicalId ledger) and `sources/gov/irvingtx/arrests/acquire.ts`: take the workspace from `intakeWorkspace`.
- [x] `test/architecture.test.ts`: fail when a `.ts` or `.mjs` file under `src/`, `scripts/` or `sources/`, other than `src/cli/command-directory.ts`, names `INTAKE_WORKSPACE` or `INTAKE_WORKSPACE_TEST` on a line that is not a comment.
- [x] Replace the two NUL bytes in `src/cli/state/source-name-to-canonical-id/index.ts` (the separator in the in-memory reverse-cache key) with the `\0` escape; the key is unchanged.
- [ ] When this branch meets `feat/parameter-store-secrets`, update `src/README.md` and `src/cli/README.md` (added there in commit `ca162ab`), which describe `intakeWorkspace` without the checks.

## Validate

- [x] Run `npm run validate`, including OpenSpec validation, for commit `6c6cc61`. No Supabase migration or loaded data changes, so no Supabase validation or integrity assertions apply.
- [x] Run `npm run validate`, including OpenSpec validation, again after the added tasks.
