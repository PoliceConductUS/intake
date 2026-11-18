# acquire

## Overview

The acquire step of a source: it runs the source's `acquire` function, or
copies local files, into a new command's `<source>/output/` directory for a
later `data transform`.

This directory exports `registerAcquireCommand` instead of
`registerCliCommand`, so it is not a top-level command. `src/cli/data/index.ts`
adds it to the `data` group as `data acquire [glob]` with
`--from-local <path...>`. The glob defaults to `*`.

`acquire-data-context.ts` gives a source read-only access to agencies and a
search over imported records. `agencies`, and `search` on `Agency` and
`AgencyPersonnel`, return the calling namespace's own source IDs, not
canonical IDs. `search` on `LocationPath` returns the row's `path`, and on
`Review` and `CivilCase` it returns the database `id`. `agencies` returns
100 agencies per page unless `limit` is given, and `search` returns at most
20 rows.

## Interface

- `index.ts:registerAcquireCommand` - `(program, dependencies)`; registers
  `acquire [glob]` with `--from-local <path...>`.
- `index.ts:acquireSource` - `(sourceId, deps)` returns a `CommandResult`.
  It does not throw: a failure to load the source's `acquire` and any later
  error are returned as `{ exitCode: 1, stderr }`. The source's `acquire` is
  passed `clients`, built by `buildServiceClients` for the source's namespace
  and this command. When a service went down during the acquire, the result
  is still exit code 0 and `stdout` has one line for each such service: the
  source, the service, the time it went down, the calls skipped and the time
  to try again.
- `acquire-data-context.ts:createAcquireDataContext` -
  `(client, ledger, namespace)` returns an `AcquireDataContext` with
  `agencies(query)` and `search(kind, query)`.
- `acquire-from-local.ts:acquireFromLocal` - `(sourceId, paths, deps)`.
- `acquire-from-local.ts:resolveLocalInputs` - `(paths, cwd, logger)` returns the
  files to copy, each as `{ source, destinationRelative }`.
- `acquire-from-local.ts:AcquireFromLocalDeps` - dependency type.
- `acquisition-completion.ts:recordCompletedAcquisition` - `(output)`.
- `acquisition-completion.ts:hasCompletedAcquisition` - `(output)` returns a
  boolean.

## Invariants

- `index.ts:registerAcquireCommand`:
  - The glob is matched against sources that have `acquire`. With
    `--from-local` it is matched against sources that have `acquire` or
    `transform`.
  - Exit code 1 when no source matches the glob, and when `--from-local` is
    given and the glob matches more than one source.
  - It stops at the first source whose `acquireSource` result is non-zero and
    appends `intake data acquire failed on source <id>` to stderr.
  - Any thrown error, including a blank workspace, becomes exit code 1 with
    the message on stderr.
  - Without `DATABASE_URL`, a call to `data.agencies` throws
    `DATABASE_URL is required for acquire data access (agencies).`, and
    `data.search` is `undefined`.
- `index.ts:acquireSource` - writes `latest` to the acquire command pointer
  and records completion only after the source's `acquire` returns.
- `acquire-from-local.ts:resolveLocalInputs` - throws on a path that does not
  exist, a glob that matches nothing, no input files, and two inputs with the
  same destination name. Inside a directory it leaves out every entry whose
  name starts with `.` and logs `--from-local: left out dotfile <path>` for
  each one through the `logger` argument.
- `acquire-data-context.ts:createAcquireDataContext` - `search` throws for a
  kind other than `LocationPath`, `Agency`, `AgencyPersonnel`, `Review` and
  `CivilCase`.
- `acquisition-completion.ts:recordCompletedAcquisition` - writes with flag
  `wx`, so it fails when the receipt already exists.
- `acquisition-completion.ts:hasCompletedAcquisition` - returns `false` when
  the receipt is missing and rethrows any error other than `ENOENT`.

## Side Effects

- `index.ts:registerAcquireCommand` - wraps `process.env` with
  `withParameterStoreSecrets`; reads the workspace through `intakeWorkspace`
  (`INTAKE_WORKSPACE`); reads and imports the
  sources under `<cwd>/sources`; connects to the database when `DATABASE_URL`
  is set; writes log lines to `process.stderr`.
- `index.ts:acquireSource` - builds the command's service clients, which
  read and write the source's `CallResult` and `BinaryFile` envelopes when
  the source calls them; creates a command directory; copies the
  `resume` directory into the new output when that directory exists; reads
  and writes the `acquire` command pointer in the source's state directory;
  runs the source's `acquire` function; calls `recordCompletedAcquisition`.
- `acquire-from-local.ts:acquireFromLocal` - creates a command directory;
  copies the local files into the command's `<source-id>/output/`; reads and
  writes the `acquire` command pointer; runs the source's `acquire` function
  when the source has one; calls `recordCompletedAcquisition`; writes one log
  line through `logger.info`.
- `acquire-data-context.ts:createAcquireDataContext` - `select` on `agency`,
  `location_path`, `agency_personnel`, `personnel`, `reviews` and
  `civil_cases`; `ledger.sourceIdFor` may write a ledger record.
- `acquisition-completion.ts:recordCompletedAcquisition` - writes the empty
  file `acquire-complete` beside the output directory.

## Verification

- Run: `npx vitest run test/cli/acquire`
