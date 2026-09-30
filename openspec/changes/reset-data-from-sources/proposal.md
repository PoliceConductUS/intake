# Reset data from sources in one command

## Why

Rebuilding from current source inputs currently requires manually moving the old mutation chain, resetting the schema, and generating and applying imports. Replaying the old chain does not exercise updated source transforms or resolution rules.

## What Changes

- Add `data reset` to reset the configured database to current migrations and rebuild from sources in dependency order.
- Add `--no-acquire` to reuse acquired inputs without invoking acquisition.
- Set aside the previous mutation chain in the reset command output and generate a new chain. Preserve acquired inputs, source identity mappings, canonical slug caches, and manual records.
- Run transform, generate, and apply for each automatic source, followed by the manual source.
- Stop on a failed phase and report an incomplete rebuild with a nonzero exit status.

## Impact

CLI orchestration and documentation. No schema, seed, dependency, or generated-contract changes. Executing this command intentionally resets the database specified by `DATABASE_URL`; implementing it does not reset the user's database.

## Capabilities

### Modified Capabilities

- `config-driven-source-import`: explicit rebuild from sources, separate from replay.
