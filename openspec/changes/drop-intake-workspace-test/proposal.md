## Why

`INTAKE_WORKSPACE_TEST` is a second name for the workspace root that takes priority over `INTAKE_WORKSPACE`. No workspace uses it: only the tests set it. It leaves two names for one setting in five places in the CLI and in the `gov/irvingtx/arrests` source, and a value left in a shell silently redirects a real command to another workspace.

## What Changes

- **Breaking:** `INTAKE_WORKSPACE_TEST` is no longer read. `INTAKE_WORKSPACE` is the only name for the workspace root.
- The tests pass their temporary workspace as `INTAKE_WORKSPACE`.
- `.env.example` loses its `INTAKE_WORKSPACE_TEST` line.

## Capabilities

### Modified Capabilities

- `artifacts-database-import`: in the requirement "Import Import Artifact", the scenario "Test import-artifacts replay workspace is isolated" now says tests set `INTAKE_WORKSPACE` and that `INTAKE_WORKSPACE_TEST` is not read. The rest of the requirement is unchanged.

## Impact

Affected code: `src/cli/command-directory.ts`, `src/cli/import/artifacts/existing-import.ts`, `src/cli/import/artifacts/config.ts`, `src/cli/transform/index.ts`, `sources/gov/irvingtx/arrests/acquire.ts`, and the tests that set the variable.

No Supabase migration, generated type, loaded data or downstream app contract changes. No data reset or production migration plan is needed.
