# data

## Overview

Registers the `data` command group and owns the chain of data mutations:
versioned `DatabaseMutations` and `IdentityRestoration` envelopes in
`$INTAKE_WORKSPACE/data/mutations`, tracked in the database table
`public.data_mutation_applied`.

Subcommands registered in `index.ts:registerCliCommand`:

- `data acquire [glob]` - added from [acquire](../acquire/README.md).
- `data transform [source]` - writes a source's `Artifacts`; with no source,
  every source in dependency order. With no source, it first checks the
  workspace with `intakeWorkspace`; a source whose `transformOneSource` call
  throws `transform/index.ts:NoAcquiredInputError` is listed as skipped, with
  the number of skipped sources; a source whose call throws any other error or
  returns an error is listed as `errored`; and the exit code is 1 when a
  source is `errored`. Each transform writes its own command log and prints
  it to `process.stderr`.
- `data generate <source>` - checks that the database is at the head of the
  chain, imports the `Artifacts` with `dryImport`, and appends the difference
  as the next chain entry. The import is given `process.env` wrapped by
  `withParameterStoreSecrets`. When a service went down during the import,
  the exit code is still 0 and the last lines of stdout name each such
  service, the calls skipped and the time to try again.
- `data up` with `--to <version>` - applies pending chain entries in order.
- `data status` - lists each entry as applied or pending.
- `data verify` - recomputes the checksums of applied entries; exit code 1 on
  a difference.
- `data update` - for each source in dependency order: transform, generate,
  up. `useInitialAgencyRoots` is the result of `agencyTableIsEmpty`. `up` is
  not run for a source with an empty diff. Exit code 1 when any source
  returned an error from transform or generate. Each import is given
  `process.env` wrapped by `withParameterStoreSecrets`, and the summary ends
  with the lines for services that went down, each with its source.
- `data reset` with `--no-acquire` - resets the database to the current
  migrations and rebuilds it from the sources. With `--no-acquire`, each
  `data` subcommand it runs is given `keepCachedCallResults: true`, so a
  cached successful call result is used whatever its `retryAfter`.
- `data exclude <source> <kind> <source-id>` with `--reason <reason>`,
  `--when <json>` and `--replace` - appends an excluded record to the source's
  state directory. The reason is published verbatim on the licensing
  authority's page as `Explicitly excluded <Kind>: <reason>`, so it must say,
  in plain words for a reader, what was left out and why.
- `data restore-identity <namespace> <kind> <source-name>` with
  `--expected-current-id <id>`, `--original-id <id>`, `--reason <reason>` and
  `--evidence <evidence>` - appends an `IdentityRestoration` chain entry and
  does not apply it.

## Interface

- `index.ts:registerCliCommand` - `(program, dependencies)`; registers the
  `data` group.
- `chain.ts:chainDir` - `(root?)` returns `<root>/mutations`; the default
  root is `$INTAKE_WORKSPACE/data`.
- `chain.ts:listEntries` - `(root?)` returns the sorted `ChainEntry` list.
- `chain.ts:generateEntry` - `(mutationsEnvelopePath, root?)` returns
  `{ written?, version?, mutationCount }`.
- `chain.ts:generateIdentityRestorationEntry` - `(client, event, root?)`
  returns `{ written, version, mutationCount: 1 }`.
- `chain.ts:assertAtHead` - `(client, root?)`.
- `chain.ts:applyPending` - `(client, { to?, root?, logger? })` returns
  `ApplyResult`.
- `chain.ts:status` - `(client, root?)` returns `StatusRow[]`.
- `chain.ts:verify` - `(client, root?)` returns the applied versions whose
  checksum changed and the applied versions that have no chain file.
- `acquired-inputs.ts:retainedAcquiredInputs` - `(workspace, source)` returns
  the relative `command/<run>/<source>/output` paths of completed
  acquisitions.
- `reset.ts:resetData` - `({ acquire }, dependencies)` returns a
  `CommandResult`.
- `reset.ts:resetConfiguredDatabase` - `(env)`; runs `supabase db reset`.
- `source-pipeline.ts:transformOneSource` -
  `(sourceId, env, terminal?, kinds?)` returns `{ artifactsPath }` or
  `{ error }`. It can also throw: the steps before `transformSource` are not
  caught.
- `source-pipeline.ts:generateOneSource` -
  `(sourceId, env, useInitialAgencyRoots?, keepCachedCallResults?)` returns
  `{ version?, mutationCount, serviceSkips }` or `{ error }`. `serviceSkips`
  is one line for each service that went down during the import.
- `source-pipeline.ts:orderedSourceIds` - sources that have a transform and
  are not standalone, ordered by `planSourceOrder`.

## Invariants

- `index.ts:withClient` (not exported) - throws
  `DATABASE_URL is required for data.` when it is blank.
- `index.ts:registerCliCommand` - `data exclude` fails with
  `Source <source> does not produce record kind <kind>. Use the singular record kind, such as Agency.`
  when no kind the source produces has that record kind, and with
  `--when must contain valid JSON.` when `--when` is not JSON.
- `chain.ts:defaultChainRoot` (not exported) - takes the workspace from
  `intakeWorkspace`, so it throws that function's errors and does not read a
  missing chain as empty.
- `chain.ts:assertAtHead` - throws on any entry that is not applied. It calls
  `assertIdentityRestorationComplete` for each applied `IdentityRestoration`
  entry.
- `chain.ts:generateEntry` - an envelope whose mutations are all `Read` kinds
  writes nothing and returns `mutationCount` 0. The version is the entry count
  plus one, padded to six digits.
- `chain.ts:generateIdentityRestorationEntry` - parses the event with
  `IdentityRestoration.schema`, then calls `assertAtHead`,
  `assertIdentityRestorationReady` and
  `assertDatabaseIdentityRestorationReady` before it writes. The annotation
  `data-mutation/min-schema` is the schema version read from the database.
- `chain.ts:applyPending`:
  - Throws when an entry's predecessor is not applied, and when the database
    schema version is below the entry's `minSchemaVersion`.
  - Throws `data: checksum drift on applied identity restoration <version>.`
    when the file of an applied `IdentityRestoration` entry differs from its
    ledger checksum.
  - Calls `assertIdentityRestorationReplayable` on a pending
    `IdentityRestoration` entry before the transaction begins.
  - The entry and its ledger row commit in one transaction.
  - Throws `data: --to <to> matches no pending entry (pending: <versions>).`
    before any entry is applied when `to` matches no pending entry.
- `acquired-inputs.ts:retainedAcquiredInputs` - calls `assertValidSourceId`
  on the source. It throws:
  - `<source>: invalid acquisition path <latest>.` when the `latest` pointer
    is not `command/<run>/<source>/output` with a chronological run name.
  - `<source>: latest acquired output is missing: <latest>.` when that
    directory is absent.
  - For a command directory that holds a completed acquisition for the
    source:
    - `Expected one Command envelope in <directory>.` unless it holds exactly
      one `*.Command.yaml`.
    - `Command namespace mismatch in <directory>.` when the `Command`
      namespace is not the source.
    - `Completed acquisition refers to a different command at <directory>.`
      when the `Command` args are not `acquire <source>` or
      `data acquire <source>`.
    - `Acquisition has no chronological command name: <name>.`
  - `<source>: latest acquisition Command is missing or invalid: <latest>.`
    when the `latest` pointer is not among the completed acquisitions.
  - `<source>: no completed acquisition.` when there is none.
- `reset.ts:resetConfiguredDatabase` - throws
  `Schema reset failed (<signal or exit code>).` when the child process does
  not exit with code 0.
- `reset.ts:resetData` - does not throw. A blank `DATABASE_URL`, any other
  error, and a phase with a non-zero exit code all stop the rebuild and return
  exit code 1 with `data reset: rebuild incomplete at <phase>: <message>` on
  stderr.
- `source-pipeline.ts:generateOneSource` - returns an error when
  `requireTransformCompletion` throws or the import exits non-zero, and the
  error `Import completed without its DatabaseMutations output.` when the
  import returns no `databaseMutationsPath`.

## Side Effects

- `index.ts:withClient` (not exported) - reads `DATABASE_URL`; connects and
  ends a database client.
- `index.ts:consoleLogger` (not exported) - writes to `process.stderr`.
- `chain.ts:generateEntry` - writes a `DatabaseMutations` file into
  `<root>/mutations`.
- `chain.ts:generateIdentityRestorationEntry` - reads the schema version
  with `readCurrentSchemaVersion`; writes an `IdentityRestoration` file into
  `<root>/mutations`.
- `chain.ts:applyPending` - runs `begin`, `commit` and `rollback`; calls
  `executeDatabaseMutations` or `restoreDatabaseIdentity`; inserts into
  `public.data_mutation_applied` through `recordDataMutationApplied`; calls
  `completeIdentityRestoration` on the workspace for each
  `IdentityRestoration` entry it applies and for each one that is already
  applied.
- `acquired-inputs.ts:retainedAcquiredInputs` - reads the acquire command
  pointer in `<workspace>/state/<source>` and the `*.Command.yaml` files under
  `<workspace>/command`.
- `reset.ts:resetConfiguredDatabase` - child process
  `node_modules/.bin/supabase db reset --remote=<DATABASE_URL> --no-seed --yes`.
  For the host `localhost`, `127.0.0.1` or `[::1]` with no `sslmode` in the
  URL, it adds `sslmode=disable` to the URL. The child environment has
  `SUPABASE_TELEMETRY_DISABLED=1`, and `PGSSLMODE` set to the URL's `sslmode`
  when the URL has one.
- `reset.ts:resetData` - creates a command directory, opens its command log
  with `dependencies.terminal` as its terminal, logs each phase and the final
  stdout of each `data` subcommand it runs, records a caught error as the
  log's last record and closes the log at the end. It runs the `data`
  subcommands through `runIntake`, each with
  `{ useInitialAgencyRoots: true, keepCachedCallResults: !acquire }`, in this
  order:
  1. For each source that is not standalone, `data transform <source>` once
     for each retained acquisition, with the acquire command pointer's
     `latest` set to that acquisition; the pointer is then restored. With
     `acquire` true, a source whose pointer has no `latest` is left out of
     this step.
  2. `resetConfiguredDatabase`.
  3. Renames `<workspace>/data/mutations` to `previous-mutations` in the
     command output; a missing directory is not an error.
  4. For each source: `data acquire <source>` when `acquire` is true, then
     `data transform <source>`, `data generate <source>` and `data up` for
     each retained acquisition (once for a standalone source), with the
     acquire command pointer rewritten and restored as in step 1.
  5. After the last source that produces `LocationPaths`:
     `transformOneSource("org/policeconduct/manual", ..., ["LocationPaths", "LocationPathAliases"])`,
     then `data generate org/policeconduct/manual` and `data up`.
  6. `data transform`, `data generate` and `data up` for
     `org/policeconduct/manual`, as in step 4.
- `source-pipeline.ts:transformOneSource` - calls `beginTransform` on
  `<workspace>/state/<source>`; runs `transformSource`, which writes the
  `Artifacts`.
- `source-pipeline.ts:generateOneSource` - calls `runImportArtifactsCommand`
  with `dryImport: true`, then `generateEntry`.

## Verification

- Run: `npx vitest run test/cli/data test/cli/data-exclude.test.ts`
