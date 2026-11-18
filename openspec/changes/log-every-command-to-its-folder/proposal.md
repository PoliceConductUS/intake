## Why

Only `data generate` and the replay of database mutations write a log file. `data acquire`, `data transform` and `data reset` print their progress to the terminal and keep nothing. Of the 190 command folders in the dev workspace, 18 have a log, all from `data generate`. The CourtListener acquire of 2026-11-17 stopped with no completion record, no output and no error anywhere on disk, so the cause cannot be found. A full CourtListener acquire runs for hours unattended; when it stops, its folder must say why.

## What Changes

- Every command that creates a command folder writes `<command-name>.log` in it, through the existing `createIntakeLog`, at the level `LOG_LEVEL` names.
- The log holds each progress line the command prints, and, when the command fails, the error that ended it, as the last record.
- The terminal output does not change.

## Capabilities

### New Capabilities

- `command-logs`: which commands write a log, where, and what it holds.

## Impact

Affected code: `src/cli/acquire/index.ts`, `src/cli/acquire/acquire-from-local.ts`, `src/cli/transform/index.ts`, `src/cli/data/reset.ts`, `src/cli/cache/index.ts`, `src/cli/photo/index.ts`, and their tests. `data generate` and `replay database-mutations` already write a log and are unchanged.

No Supabase migration, generated type, loaded data or downstream app contract changes. No data reset or production migration plan is needed.
