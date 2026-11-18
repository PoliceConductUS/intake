# database-mutations

## Overview

Registers `replay database-mutations <database-mutations-ref>`, which runs an
existing `DatabaseMutations` file against `DATABASE_URL`.

`config.ts` opens the database client and wraps the replay in one
transaction. `execute.ts` executes each mutation: creates in batches, updates
with a check of the current row, and reads as no-ops. `data up` uses
`execute.ts` too, through `src/cli/data/chain.ts:applyPending`.

## Interface

- `index.ts:registerCliCommand` - `(replayCommand, dependencies)`; registers
  `database-mutations <database-mutations-ref>`. It has no options.
- `index.ts:runReplayDatabaseMutationsCommand` -
  `(databaseMutationsRef, dependencies?)` returns a `CommandResult`.
- `config.ts:replayDatabaseMutations` -
  `(input: ReplayDatabaseMutationsCommandInput)` returns
  `ReplayDatabaseMutationsResult`: `{ ok: true, counts }` or
  `{ ok: false, error }`.
- `config.ts:ReplayDatabaseMutationsCommandInput` -
  `{ databaseMutationsPath, env?, clientFactory? }`.
- `execute.ts:executeDatabaseMutations` - `(client, databaseMutationsPath)`
  returns `DatabaseMutationCounts`. It does not open a transaction.
- `execute.ts:DatabaseMutationCounts` - type re-export from
  `src/cli/import/artifacts/io/DatabaseMutationCounts.ts`.

## Invariants

- `index.ts:readableDatabaseMutationsFileResult` (not exported) - exit code 1
  with `DatabaseMutations is not readable: <ref>` when the ref cannot be
  read, and with `DatabaseMutations is not a file: <ref>` when it is not a
  file.
- `index.ts:runReplayDatabaseMutationsCommand` - the command directory's
  namespace is the file's `metadata.namespace`. It returns exit code 1,
  before a command directory is created, when the file cannot be read as a
  `DatabaseMutations` envelope, and exit code 1 when the command directory
  cannot be created.
- `config.ts:replayDatabaseMutations` - returns an error when `DATABASE_URL`
  is blank; any error rolls the transaction back. An error from `rollback`
  and an error from `client.end()` are discarded.
- `execute.ts:databaseMutationMetadata` (not exported) - throws
  `Unsupported DatabaseMutation record kind` when the kind is absent from
  `TABLE_BY_KIND` or `PRIMARY_KEY_BY_KIND`.
- `execute.ts:executeCreateBatch` (not exported) - throws
  `DatabaseMutation cannot create <kind>: <database message>: <database detail>`
  when the insert violates a unique constraint, and
  `cannot create existing <kind>` when a row's key was not inserted.
- `execute.ts:databaseSpecForMutation` (not exported) - the columns a create
  writes:
  - `LocationPath`: `centroid` and `bbox` go through
    `locationPathCentroidGeoJson` and `locationPathBboxGeoJson`; the other
    properties are written unchanged.
  - `LocationPathGeometry`: `sourceLocationPathKey` and `selectedYear` are
    dropped, and `geometry` is written to the column `boundary`.
  - Every other kind: a property in `JSON_PROPERTIES` is written with
    `JSON.stringify`, except that `null` stays `null` unless the property is
    in `JSON_REQUIRED_PROPERTIES`; every other property goes through
    `timestampValue`.
- `execute.ts:executeUpdate` (not exported) - throws on a missing row, a malformed
  operation, an action other than `check` or `set`, and a change to the
  primary key, `slug` or `LocationPath.path`.
- `execute.ts:assertExpectedValue` (not exported) - throws when a `check` value or a `set`
  `from` value differs from the current row.
- `execute.ts:executeDatabaseMutations` - throws on an operation other than
  create, update or read. A create batch holds at most `MAX_INSERT_ROWS`
  (1000) rows, `MAX_INSERT_PARAMETERS` (60000) bind parameters and
  `MAX_INSERT_PAYLOAD_BYTES` (1048576) bytes; a single row over a limit is
  still sent as a batch of one. A batch also ends when the kind or the set of
  defined columns changes, and before any mutation that is not a create.
- `execute.ts:iterateMutations` (not exported) - a referenced mutation is read with
  `expectedNamespace` set to the envelope's namespace.

## Side Effects

- `index.ts:runReplayDatabaseMutationsCommand` - reads the
  `DatabaseMutations` file for its namespace; creates a command directory,
  which reads the workspace variable through `createCommandDirectory`; writes
  `<commandDirectory>/<commandName>.log`; reads `LOG_LEVEL`.
- `config.ts:replayDatabaseMutations` - reads `DATABASE_URL`; connects, then
  runs `begin` and `commit`, or `rollback` on error.
- `execute.ts:iterateMutations` (not exported) - reads the `DatabaseMutations` file, its
  chunk files and the referenced mutation files.
- `execute.ts:executeCreateBatch` (not exported) - multi-row insert into the kind's table
  through `createDatabaseRecords`.
- `execute.ts:executeUpdate` (not exported) - `select ... for update` on the row, then
  `updateDatabaseRecordFields`.

## Verification

- Run: `npx vitest run test/import/replay-batch-limits.test.ts test/import/replay-payload-limit.test.ts test/import/personnel-replay-validation.test.ts`
- Run: `npx vitest run test/import/replay-database-mutations.integration.test.ts`
