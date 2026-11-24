# cli

## Overview

The `intake` command-line program. `index.ts` is the entry point: it loads
the local environment file and calls `runIntake`, which builds the
`commander` program and registers commands by discovery.
`registerDiscoveredCommands` (`src/shared/cli/command-discovery.ts`) loads
the `index` module of each subdirectory that contains `index.js` or
`index.ts`, and calls its `registerCliCommand` export when it has one.
`import` and `state` have no index file and are not loaded.

Top-level commands and the subdirectory each comes from:

| Command     | Subdirectory | Subcommands                                                                                                    |
| ----------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| `cache`     | `cache`      | `alias`, `get`, `set`, `unset`                                                                                 |
| `data`      | `data`       | `acquire`, `transform`, `generate`, `up`, `status`, `verify`, `update`, `reset`, `exclude`, `restore-identity` |
| `photo`     | `photo`      | `import`                                                                                                       |
| `replay`    | `replay`     | `database-mutations`                                                                                           |
| `requests`  | `requests`   | `submit`, `status`, `sync`                                                                                     |
| `sources`   | `sources`    | `daily`                                                                                                        |
| `workspace` | `workspace`  | `migrate-state`                                                                                                |

`acquire`, `database`, `import`, `state` and `transform` register no
top-level command; the commands above call them.

The files in this directory also define the contract of a source module
(`intake-source.ts`), find and load sources under `sources/`, create the
command directory of each command, and read API keys from AWS Systems Manager
Parameter Store.

## Interface

- `index.ts:loadCliEnvironment` - loads the local environment file with
  `process.loadEnvFile()`; a missing file is not an error.
- `index.ts:runIntake` - re-export of `run-intake.ts:runIntake`. `index.ts`
  also re-exports `runImportArtifactsCommand` and
  `runReplayDatabaseMutationsCommand`, and the types `IntakeCliDependencies`
  and `CommandResult`.
- `run-intake.ts:runIntake` - `(args, dependencies?)` returns a
  `CommandResult`: `{ exitCode, stdout?, stderr? }`. When the action passed a
  `CommandResult` to `setResult`, it returns that one. Otherwise it returns
  exit code 0 with the output `commander` wrote.
- `run-intake.ts:IntakeCliDependencies` - optional `useInitialAgencyRoots`,
  `keepCachedCallResults`, `runImportArtifactsCommand` and
  `runReplayDatabaseMutationsCommand`.
- `intake-source.ts:IntakeSource` - the contract each `intake.source.ts`
  exports: optional `description`, `standalone`, `acquire`, `request`,
  `portalForm` and `daily` (`(env) => Promise<void>`); `transform` and `produces` are given together or
  not at all.
- `source-discovery.ts:loadIntakeSource` - `(sourceId, root)` returns the
  `IntakeSource`.
- `source-discovery.ts:discoverSources` - `(root)` returns
  `{ id, phases, source }` for every source, sorted by ID.
- `source-discovery.ts:SourcePhase` - `acquire`, `transform`, `request` or
  `daily`.
- `source-glob.ts:matchSourceIds` - `(sourcesRoot, glob, operations)` returns
  the matching source IDs.
- `source-glob.ts:globToRegExp` - `(glob)`; supports `*` and `?`.
- `source-namespace.ts:sourceNamespace` - `(sourcesRoot, sourceDirectory)`
  returns the namespace: the directory path relative to the sources root.
- `source-namespace.ts:moduleSourceNamespace` - `(moduleUrl)`.
- `describe-sources.ts:describeSources` - `(sourcesRoot)` returns
  `SourceDescription[]`.
- `describe-sources.ts:SourceDescription` - `{ id, phases }` with optional
  `description` and `produces`. The file also re-exports the type
  `SourcePhase`.
- `describe-sources.ts:renderSourceCatalog` - `(sources)` returns the text
  `intake sources` prints. Each source has a line `<id>  [<phases>]`, then
  its description when it has one. A source with a non-empty `produces` also
  has a `produces:` line, and a `consumes:` line when `consumesOf` returns
  any kind. An empty list returns `No sources found under sources/.`
- `command-directory.ts:intakeWorkspace` - `(env)` returns
  `INTAKE_WORKSPACE`, an absolute path to an existing folder.
- `command-directory.ts:createCommandDirectory` - `(env, options?)` returns
  `{ commandDirectory, commandName, commandPath, outputDirectory }`.
- `command-directory.ts:commandOutputDir` - `(commandDirectory, namespace)`
  returns `<commandDirectory>/<namespace>/output`.
- `parameter-store-env.ts:withParameterStoreSecrets` - `(env, read?)` returns
  `env` with the API keys read from Parameter Store on first use.
- `parameter-store-env.ts:Environment` - `Record<string, string | undefined>`.
- `parameter-store-env.ts:ReadParameter` - `(parameterName) => string`; the
  type of the `read` argument.
- `parameter-store-env.ts:PARAMETER_STORE_SECRETS` - the API key names:
  `ANTHROPIC_API_KEY`, `CLEARING_HOUSE_API_TOKEN`, `COURTLISTENER_API_TOKEN`,
  `RESEND_API_KEY`, `RESEND_API_KEY_FULL_ACCESS`, `YOUTUBE_API_KEY`.
- `parameter-store-env.ts:parameterName` - `(secretName)` returns
  `/policeconduct/secrets/<secretName>`.
- `service-clients.ts:buildServiceClients` -
  `({ workspace, namespace, commandId, env, keepCachedCallResults?, logger? })`
  returns the `ServiceClients` of one command (see
  [shared/services](../shared/services/README.md)). Their call results and
  files are kept under `namespace`, and each outcome names `commandId`.
- `intake-version.ts:intakeVersion` - returns the commit of intake that is
  running.
- [acquire](./acquire/README.md) - `data acquire`: runs a source's `acquire`
  function, or copies local files, into a new command's output.
- [cache](./cache/README.md) - `cache`: inspects or corrects a record
  property by source identity.
- [data](./data/README.md) - `data`: the command group and the chain of data
  mutations.
- [database](./database/README.md) - the database client and queries.
- [import](./import/README.md) - compares `Artifacts` with the database and
  writes `DatabaseMutations`.
- [photo](./photo/README.md) - `photo import`: stores a personnel portrait.
- [replay](./replay/README.md) - `replay database-mutations`: runs a
  `DatabaseMutations` file against the database.
- [requests](./requests/README.md) - `requests`: submits records requests and
  synchronizes replies.
- [sources](./sources/README.md) - `sources`: lists sources and runs a
  source's `daily` function.
- [state](./state/README.md) - state that outlives one command: command
  pointers, manual records, transform completion, the resolved property cache
  and the source-name mapping.
- [transform](./transform/README.md) - runs a source's `transform` function
  and writes `Artifacts`.
- [workspace](./workspace/README.md) - `workspace migrate-state`: copies
  private state into a separate workspace.

## Invariants

- `index.ts:loadCliEnvironment` - rethrows any error other than `ENOENT`.
- `run-intake.ts:runIntake` - a `CommanderError` becomes a `CommandResult`
  with that error's exit code; any other error is rethrown.
- `command-directory.ts:intakeWorkspace` - throws
  `INTAKE_WORKSPACE is required: the absolute path of an existing workspace folder.`
  when the workspace is unset or blank;
  `INTAKE_WORKSPACE must be an absolute path: <value>` for a relative path;
  `INTAKE_WORKSPACE <value> is not an existing folder.` when it names nothing
  or a file; and `INTAKE_WORKSPACE <value> cannot be read: <reason>` when it
  cannot be checked. It never creates the folder.
- `command-directory.ts:createCommandDirectory` - throws
  `Command directory is not writable` when the directory cannot be created.
  It checks the workspace with `intakeWorkspace` and `LOG_LEVEL` with
  `logging.ts:assertLogLevel` before it creates anything. The namespace
  defaults to `intake`.
- `command-directory.ts:commandOutputDir` - calls `assertValidSourceId` on
  the namespace.
- `source-discovery.ts:loadIntakeSource` - calls `assertValidSourceId` on the
  source ID first. It throws
  `Unknown source id: missing intake.source.ts at <file>` when the marker file
  is missing, `Source <id>: intake.source.ts must export a source object.`
  when the module exports no `source` object, and
  `Source <id>: <phase> must be a function.` when `acquire`, `transform` or
  `daily` is present and is not a function. It also throws
  `Source <id>: transform and produces must be declared together.`,
  `Source <id> must declare a produces array`,
  `Source <id> produces an unknown kind: <kind>`, and
  `Source <id>: request is malformed at <path>.` when `request` does not pass
  `requests/lifecycle.ts:requestDefinitionSchema`.
- `source-namespace.ts:sourceNamespace` - throws
  `Invalid source directory outside the sources root: <directory>` when the
  source directory is outside the sources root or is the sources root itself.
  It calls `assertValidSourceId` on the namespace.
- `parameter-store-env.ts:withParameterStoreSecrets` - the stored value
  replaces any local value. The value is trimmed. Each key is read once for
  each wrapped `env` and then kept. A command that reads none of the keys
  does not contact AWS. It throws:
  - `Could not read <name> from Parameter Store. Check AWS_PROFILE and that the parameter exists. <detail>`
    when the read fails.
  - `<name> in Parameter Store is empty.` when the trimmed value is empty or
    is the literal `None`.

## Side Effects

- `index.ts:loadCliEnvironment` - `process.loadEnvFile()` sets
  `process.env` from the local environment file.
- `index.ts:main` - writes the result to `process.stdout` and
  `process.stderr` and sets `process.exitCode`. It first calls
  `logging.ts:watchCommandLogs(process)`, so a process that ends while a
  command log is open writes a final record to that log.
- `run-intake.ts:createProgram` (not exported) - `registerDiscoveredCommands`
  lists this directory and imports the `index` module of each subdirectory
  that contains `index.js` or `index.ts`.
- `command-directory.ts:createCommandDirectory` - creates
  `<workspace>/command/<timestamp>-<commandName>/<namespace>/output` and
  writes a `Command` envelope into the command directory. The command name is
  a cuid2 unless `createCommandName` is given; the directory name holds it
  passed through `encodeURIComponent`. The envelope's `sharedIoRoot` is
  `options.sharedIoRoot`, else `INTAKE_SHARED_IO_ROOT`, else
  `<cwd>/dist/shared/io`.
- `source-discovery.ts:loadIntakeSource` - `lstat` on
  `<root>/<sourceId>/intake.source.ts`, then a dynamic `import` of that file.
- `source-discovery.ts:discoverSources` - lists every directory under the
  sources root and imports each `intake.source.ts`.
- `service-clients.ts:buildServiceClients` - nothing until a client is
  called. A client reads and writes
  `<workspace>/state/intake/namespaces/<namespace>/CallResult` and
  `BinaryFile`, calls its service with the global `fetch`, and reads
  `COURTLISTENER_API_TOKEN` or `ANTHROPIC_API_KEY` from `env` at its first
  call.
- `intake-version.ts:intakeVersion` - child process `git rev-parse HEAD` in
  the intake checkout, once for each process. It throws when `git` fails.
- `parameter-store-env.ts:readParameterWithAwsCli` (not exported) - child
  process
  `aws ssm get-parameter --region us-east-1 --name <name> --with-decryption --query Parameter.Value --output text`,
  with `--profile` when `AWS_PROFILE` is set.

## Verification

- Run: `npx vitest run test/cli.test.ts test/cli/parameter-store-env.test.ts test/cli/describe-sources.test.ts test/cli/service-clients.test.ts`
- Run: `npm run test:vitest`
