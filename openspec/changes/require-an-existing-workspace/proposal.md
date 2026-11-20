## Why

Before this change, `createCommandDirectory` created the workspace folder, with `mkdir -p`, when `INTAKE_WORKSPACE` named a folder that did not exist. A mistyped or relative path therefore started a new, empty workspace with no command history and an empty source-name mapping, and the next `data generate` minted new canonical IDs for records that already had one. Until 2026-11-17 (commit `fd33006`) `mise.toml` set `INTAKE_WORKSPACE = "../intake-workspace/dev"`, which from a branch folder names `~/dev/PoliceConductUS/intake/intake-workspace/dev`: a folder that does not exist. `.env.example` gave a relative path, which depends on the folder a command is run from.

Other readers of the variable did the same: `intake requests` and `scripts/publish-import-schemas.ts` ran `mkdir -p` under it, `scripts/seed-tcole-ledger.ts` wrote SourceNameToCanonicalId records into a new workspace, `data up`, `data status` and `data verify` read a missing chain as empty, and `data transform` with no source listed each source as skipped and exited 0.

## What Changes

- **Breaking:** every command and script that uses the workspace fails before it reads or writes anything in it when `INTAKE_WORKSPACE` is unset, blank, a relative path, or not an existing folder. The error names the variable and its value.
- **Breaking:** a relative path is rejected even when it names an existing folder. `.env.example` gives an absolute path.
- A new workspace is started by creating its folder; no command creates one.
- Every reader of the variable takes the workspace from `intakeWorkspace` (`src/cli/command-directory.ts`); `sourceLedgerRoot` no longer falls back to `process.env`. An architecture test fails when any other file names the variable.
- A folder that exists but is the wrong workspace still passes; this change does not detect it.

## Capabilities

### Modified Capabilities

- `config-driven-source-import`: adds the requirement "Every command requires an existing workspace named by an absolute path", with one scenario per entry point. The owner chose this capability (the accepted spec for CLI commands) on 2026-11-18, taking the review's recommendation. The accepted scenario "Workspace path is missing" in `artifacts-database-import` stays as it is and remains true.

## Impact

Affected code: `src/cli/command-directory.ts` (`intakeWorkspace`), `src/cli/requests/index.ts`, `src/cli/data/chain.ts` (`defaultChainRoot`), `src/cli/data/index.ts` (`data transform`), `src/cli/state/source-name-to-canonical-id/index.ts` (`sourceLedgerRoot`) and `restore.ts`, `src/cli/state/source-name-to-canonical-id/seed-from-identity-maps.ts`, `src/cli/import/artifacts/existing-import.ts`, `src/cli/import/artifacts/config.ts`, `src/cli/transform/index.ts`, `sources/gov/irvingtx/arrests/acquire.ts`, `scripts/publish-import-schemas.ts`, `scripts/seed-tcole-ledger.ts`, `.env.example`. Tests: `test/cli/command-directory.test.ts`, `test/architecture.test.ts`, and the tests that set the variable to a relative or missing path.

The change `drop-intake-workspace-test` edits the same readers and `test/cli/command-directory.test.ts`. On the owner's ruling of 2026-11-20 the two branches were merged into one; `drop-intake-workspace-test` lists the merge steps.

No Supabase migration, generated type, loaded data or downstream app contract changes. No data reset or production migration plan is needed.
