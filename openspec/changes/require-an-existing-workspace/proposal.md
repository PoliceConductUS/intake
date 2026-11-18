## Why

`createCommandDirectory` creates the workspace folder, with `mkdir -p`, when `INTAKE_WORKSPACE` names a folder that does not exist. A mistyped or relative path therefore starts a new, empty workspace with no command history and an empty source-name mapping, and the next `data generate` mints new canonical IDs for records that already have one. Until 2026-11-17 `mise.toml` set `INTAKE_WORKSPACE = "../intake-workspace/dev"`, which from a branch folder names `~/dev/PoliceConductUS/intake/intake-workspace/dev`: a folder that does not exist. `.env.example` still gives a relative path, which depends on the folder a command is run from.

## What Changes

- **Breaking:** every command fails before it writes anything when `INTAKE_WORKSPACE` names a path that is not an existing folder. The error names the path as given and as resolved.
- A new workspace is started by creating its folder; no command creates one.
- `.env.example` gives an absolute path.

## Capabilities

### Modified Capabilities

- `artifacts-database-import`: in the requirement "Per-Source Mapping Resolution", the scenario "Workspace path is missing" also covers a path that names no existing folder.

## Impact

Affected code: `src/cli/command-directory.ts` (`intakeWorkspace`), its callers' tests, `.env.example`.

No Supabase migration, generated type, loaded data or downstream app contract changes. No data reset or production migration plan is needed.
