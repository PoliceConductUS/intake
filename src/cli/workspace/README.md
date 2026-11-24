# workspace

## Overview

Registers `workspace migrate-state`, which copies private state from one
workspace into a separate workspace. It renames namespaces, command output
paths and annotation IDs with three JSON maps the caller supplies.

Required options: `--from <directory>`, `--to <directory>`,
`--namespaces <file>`, `--command-paths <file>` and
`--annotation-ids <file>`.

## Interface

- `index.ts:registerCliCommand` - `(program, deps)`; registers
  `workspace migrate-state`. On success it prints the report as JSON. On
  failure it returns exit code 1 and writes `String(error)` to stderr, so the
  line reads `Error: <message>`.
- `migrate-state.ts:migrateState` - `(options: MigrationOptions)` returns a
  report: `processed`, `written`, `identical`, `omittedPointers`,
  `unmappedAnnotations`, `archivedProperties`.
- `migrate-state.ts:MigrationOptions` - `from`, `to`, `namespaces`,
  `commandPaths`, `annotationIds`, optional `getLocationPathById` and
  `progress`.
- `migrate-state.ts:stringMap` - schema for the three map files: an object of
  non-empty strings.

## Invariants

- `migrate-state.ts:migrateState` - `from` and `to` must both exist; each is
  resolved with `realpath`. It throws
  `Migration workspaces must be separate directories.` when one workspace is
  inside the other.
- `migrate-state.ts:migrateState` - calls `assertValidSourceId` on the old
  and the new name of each namespace. It throws `Invalid namespace mapping`
  when the old name is `intake` or contains `/`, and when the new name is
  `intake` or starts with `intake/`. It throws
  `Migration map has duplicate targets.` when two keys map to one target.
- `migrate-state.ts:migrateState` - throws `Invalid command path` unless each
  key and each value of the command path map starts with `command/`, is
  normalized, and contains no `\`.
- `migrate-state.ts:migrateState` - throws `Unmapped namespace` for a
  namespace absent from the map, and
  `Envelope namespace differs from owning folder` when an envelope's
  namespace is not its folder's.
- `migrate-state.ts:migrateState` - throws `Conflicting destination file`
  when the destination holds a different file, and
  `Unsupported state envelope` for a state file of a kind it does not handle.
- `migrate-state.ts:migrateState` - a command pointer or a completed
  transform that names a command output is copied only for a mapped command
  path:
  - The mapped output must already exist under `to`; `reference` (not
    exported) calls `access` on it and the migration fails when it is absent.
  - A reference with no mapped command path is left out and listed in
    `omittedPointers`.
- `migrate-state.ts:migrateState` - it also throws:
  - `Namespace key collision.` when two renamed keys of one record become
    the same key.
  - `Output escaped destination` when a directory to create is outside `to`.
  - `Unsafe destination directory` when a destination directory path is not
    a directory.
  - `Unsafe command reference` when a mapped command output is outside `to`.
  - `Invalid source-scoped property path` when a historical resolved
    property is outside the `intake` namespace or its file name is not the
    canonical one.
  - `Missing canonical identity for historical property` when the ledger has
    no canonical ID for the property's subject.
  - `Missing active canonical property for historical property` when the
    canonical ID has no resolved property.
  - `Historical property archive digest mismatch` when the archived copy has
    a different digest.
  - `Invalid manual snapshot pointer` when a manual snapshot pointer's `path`
    is not `<sha256>.json` or the chain repeats a snapshot.
  - `Manual snapshot digest mismatch` when a snapshot differs from its
    `sha256`.
  - `Malformed private article key.` when an `articleKey` is not a JSON array
    that starts with a string.
  - `Changed completed transform` when the mapped `Artifacts` or input
    directory has a different digest from the completion record.
  - `Invalid transform completion` when the status is not `started` or
    `complete`.
  - `Unsupported state directory entry` for an entry that is not a file or a
    directory.
  - `Unexpected state entry` for a file at the namespace level.
- `migrate-state.ts:migrateState` - each error from a worker is rethrown
  with the source file path as a prefix: `<source file>: <error>`.
- `migrate-state.ts:migrateState` - at the namespace level it skips every
  entry whose name starts with `.`, and it skips `state/intake`.
- `migrate-state.ts:migrateState` - runs 16 workers and calls `progress`
  after every 50000 files.
- `index.ts:registerCliCommand` - `getLocationPathById` throws
  `DATABASE_URL is required to verify agency place IDs.` when it is called
  without `DATABASE_URL`.

## Side Effects

- `index.ts:registerCliCommand` - reads the three JSON map files; reads
  `process.env.DATABASE_URL` and connects to the database only when a
  `location_path` must be read; writes progress lines to `process.stderr`.
- `migrate-state.ts:migrateState` - reads `state/`, `intake/state/namespaces/`,
  `state/intake/namespaces/` and the mapped namespace folders under `from`;
  writes the migrated files under `to`; creates and removes a
  `.migrate-state-*` temporary directory in `to`.
- `migrate-state.ts:migrateState` - copies each historical resolved property
  to
  `<to>/backups/namespace-migration/source-scoped-resolved-properties/` and
  writes `manifest.json` there when it copied any. It copies each file under
  a `.idea` directory of `state/intake/namespaces/` to
  `<to>/backups/namespace-migration/editor-files/`.

## Verification

- Run: `npx vitest run test/cli/workspace`
