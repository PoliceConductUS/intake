## Why

Before this change (as on `main` at `f5ec41e`), `INTAKE_WORKSPACE_TEST` was a second name for the workspace root that took priority over `INTAKE_WORKSPACE`. No operator setup used it: `.env.example` marked it test-only, `mise.toml` (the tool and environment file this repo's shells load) did not set it, and only the tests set it. Some readers of the workspace honored it and others did not:

- Honored it: `src/cli/command-directory.ts` (`intakeWorkspace`), `src/cli/import/artifacts/existing-import.ts`, `src/cli/import/artifacts/config.ts`, `src/cli/transform/index.ts` and the `gov/irvingtx/arrests` acquire step.
- Read only `INTAKE_WORKSPACE`: `src/cli/data/chain.ts` (the data-mutation chain under `$INTAKE_WORKSPACE/data`), `src/cli/requests/index.ts`, `src/cli/state/source-name-to-canonical-id/index.ts` (`sourceLedgerRoot`, the SourceNameToCanonicalId records that hold canonical IDs; `scripts/seed-tcole-ledger.ts` reaches the workspace through it) and `scripts/publish-import-schemas.ts`.

With both set, command output, the data-mutation chain and the SourceNameToCanonicalId records could go to different workspaces, and a value left in a shell silently redirected a real command to another workspace.

The change `require-an-existing-workspace` (branch `afk-2026-11-17`, implemented in commit `bd2f26e`) routes every reader through `intakeWorkspace`, which still gives `INTAKE_WORKSPACE_TEST` priority. With that change alone, a value left in a shell redirects every command, not only some.

Tests that set no workspace have the same problem from the other side: under `mise`, `INTAKE_WORKSPACE` names the dev workspace, so such a test reads and writes the dev workspace.

## What Changes

- **Breaking:** `INTAKE_WORKSPACE_TEST` is no longer read. `INTAKE_WORKSPACE` is the only name for the workspace root.
- **Breaking:** when `INTAKE_WORKSPACE_TEST` is defined, with any value including blank, every command and script that uses the workspace fails before it reads or writes anything, with `INTAKE_WORKSPACE_TEST is no longer read; unset it and set INTAKE_WORKSPACE.` This is one check in `intakeWorkspace` (`src/cli/command-directory.ts`), made before its other checks. Every reader of the workspace calls `intakeWorkspace` once `require-an-existing-workspace` is merged into this branch.
- The tests pass their temporary workspace as `INTAKE_WORKSPACE`.
- The test runner blanks `INTAKE_WORKSPACE` (`test.env` in `vitest.config.ts`), so a test that sets no workspace fails with the error that names `INTAKE_WORKSPACE` instead of reading or writing the dev workspace.
- `.env.example` loses the lines that describe `INTAKE_WORKSPACE_TEST`.
- An architecture test fails when a `.ts`, `.cts`, `.mts` or `.mjs` file under `src/`, `scripts/`, `sources/` or `test/` names `INTAKE_WORKSPACE_TEST`, other than `src/cli/command-directory.ts` (which makes the check), `test/cli/command-directory.test.ts` (which tests it) and `test/architecture.test.ts` (which must contain the name to search for it).
- The owner ruled on 2026-11-20 that `afk-2026-11-17` and `feat/parameter-store-secrets` are merged into one branch off `main`. tasks.md lists the steps of that merge.

This change is implemented on branch `feat/parameter-store-secrets`; the open tasks are in tasks.md.

## Non-Goals

- Correcting the older names in "Import Import Artifact" (quoted as accepted), including in the rewritten scenario.
- Routing readers through `intakeWorkspace`; that is `require-an-existing-workspace`. This change edits that change's documents and READMEs only where the merge steps in tasks.md say so.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `config-driven-source-import`: adds the requirements "The workspace root is read only from INTAKE_WORKSPACE", for every command and script that uses the workspace, and "The test runner blanks INTAKE_WORKSPACE". This capability is the accepted spec for CLI commands; the owner placed the workspace rule here on 2026-11-18, as the `require-an-existing-workspace` proposal records.
- `artifacts-database-import`: in the requirement "Import Import Artifact" (title quoted as accepted), the scenario "Test import-artifacts replay workspace is isolated" now says a test isolates its `ImportArtifacts` artifact by setting `INTAKE_WORKSPACE`, and that the import fails when `INTAKE_WORKSPACE_TEST` is set. It was the only accepted spec text that names `INTAKE_WORKSPACE_TEST`. The scenario keeps its title because OpenSpec archive refuses a MODIFIED requirement that drops a current scenario title (`specs-apply.js` in `@fission-ai/openspec`). The rest of the requirement is copied unchanged.

## Impact

Files on this branch:

- Modified (done): `src/cli/command-directory.ts`, `src/cli/import/artifacts/existing-import.ts`, `src/cli/import/artifacts/config.ts`, `src/cli/transform/index.ts`, `sources/gov/irvingtx/arrests/acquire.ts`, `.env.example`, the test helper `test/import/completed-artifacts.ts`, and the tests that set the variable on `main`: `test/cli/cache-alias.test.ts`, `test/cli/data-exclude.test.ts`, `test/cli/data/source-pipeline-completion.test.ts`, `test/cli/transform/completion.test.ts`, and under `test/import/`: `agency-selection.integration.test.ts`, `artifacts-command.test.ts`, `authority-license.integration.test.ts`, `initial-agency-roots.integration.test.ts`, `manual-location-path-alias.integration.test.ts`, `manual-location-path.integration.test.ts`, `replay-database-mutations.integration.test.ts` and `slug-preservation.integration.test.ts`.
- Created (done): `test/cli/command-directory.test.ts`.
- Open: `src/cli/command-directory.ts` (the check), `test/cli/command-directory.test.ts`, `test/architecture.test.ts`, `vitest.config.ts`, the tests that fail once the test runner blanks `INTAKE_WORKSPACE`, and `src/cli/import/artifacts/README.md`.

The merge of `afk-2026-11-17` into this branch also touches the files that name `INTAKE_WORKSPACE_TEST` on `afk-2026-11-17`, files both branches changed, and the `require-an-existing-workspace` documents, whose requirement still takes the workspace from `INTAKE_WORKSPACE` "(or `INTAKE_WORKSPACE_TEST` when that is set)". tasks.md lists what that takes.

No Supabase migration, generated type, loaded data or downstream app contract changes. No data reset or production migration plan is needed.

## Alternatives Considered

- **Ignore `INTAKE_WORKSPACE_TEST` when it is set** (what this branch did first). Rejected by the owner on 2026-11-20: AGENTS.md says to "fail loudly on the old one" when a contract changes, and a value left in a shell would send a command to the workspace `INTAKE_WORKSPACE` names with no message.
- **Keep the variable and have every reader honor it** (what `require-an-existing-workspace` does on its own). Rejected: two names for one setting stay, and a stale value redirects every command.
- **Honor it only under the test runner.** Rejected: it is a fallback, which AGENTS.md forbids, and product code would behave differently under tests than in real runs.
- **Stack one branch on the other** so the reconciliation happens in a normal `git town sync`. Rejected by the owner on 2026-11-20 in favor of merging the two branches into one.

## Risks & Mitigations

- A developer who kept `INTAKE_WORKSPACE_TEST` exported now has every command and test that uses the workspace fail. Mitigation: the error says what to unset and what to set.
- A test that set no workspace and relied on the dev workspace that `mise` names now fails. Mitigation: each such test gets its own temporary workspace in the task that blanks `INTAKE_WORKSPACE`.
- Security: none beyond the risks above; no secret or access control changes.

## Open Questions

None. The owner answered the three earlier questions on 2026-11-20: a set `INTAKE_WORKSPACE_TEST` fails loudly; the test runner blanks `INTAKE_WORKSPACE`; `afk-2026-11-17` and `feat/parameter-store-secrets` are merged into one branch.
