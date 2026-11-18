# src Blueprint

## System Overview

`src/` holds the `intake` CLI and the code it shares with the sources under
[`sources/`](../sources/README.md). `cli/` is the program: it registers each
command by discovery and holds the acquire, transform and import steps, the
chain of data mutations, database access and the state that outlives one
command. `shared/` holds the canonical envelope IO and the value rules that
apply to every entity kind and source namespace. `types/` holds ambient type
declarations.

## Local Interface & Invariants

- `logging.ts:createIntakeLog`: `(options) => IntakeLog`. Builds a pino logger
  that writes each record at or above `options.level` (default `info`) to the
  command's log file and, unless `terminal: false`, the message text of each of
  those records to the terminal stream (default `process.stdout`). A record
  below that level reaches neither. The import and the replay of database
  mutations pass `LOG_LEVEL` as `level`.
- `logging.ts:IntakeLog`: type `{ logger, logPath }`.
- Invariant: `logging.ts:createIntakeLog` throws
  `Command log path is required to write intake logs.` when `logPath` is
  missing or blank.
- Side effect: `logging.ts:createIntakeLog` creates the log file's directory
  and opens the file for synchronous append.

## Subdirectories & System Boundaries

- cli: [./cli/README.md](./cli/README.md) - Entry point of the `intake` CLI.
  Top-level commands are `cache`, `data`, `photo`, `replay`, `requests`,
  `sources` and `workspace`; `acquire`, `database`, `import`, `state` and
  `transform` register no command of their own. Also defines the source module
  contract, source discovery, the command directory and the reading of API keys
  from AWS Parameter Store.
- shared: [./shared/README.md](./shared/README.md) - Code used by the CLI
  commands, the sources and the import: canonical envelope IO
  ([./shared/io/README.md](./shared/io/README.md)), the command registration
  contract ([./shared/cli/README.md](./shared/cli/README.md)), and value rules
  such as the source namespace pattern, timestamp and license-type
  normalization, agency address checks and data annotation schemas.
- types: [./types/README.md](./types/README.md) - The ambient declaration for
  the untyped `namecase` package.

## Global Invariants

- Every envelope schema requires `apiVersion` to equal
  `shared/io/intake-api-version.ts:INTAKE_API_VERSION` and its own `kind`, and
  is strict on the envelope, `metadata` and `spec`
  ([./shared/io/README.md](./shared/io/README.md)).
- `shared/io/generated/` and `cli/import/artifacts/io/generated-mutations/` are
  written by `scripts/generate-envelope-types.ts` and hold no README:
  `test/generated-files.integration.test.ts` regenerates each folder and
  requires every file to equal the generator output after both are formatted
  with Prettier, so a formatting-only difference passes. The same test
  compares `docs/data-request-format.md` with the output of
  `scripts/generate-data-request-doc.ts`. Their contracts are in
  [./shared/io/README.md](./shared/io/README.md) and
  [./cli/import/artifacts/io/README.md](./cli/import/artifacts/io/README.md).
- A command folder under `cli/` is registered only when its index module
  exports `registerCliCommand`
  (`shared/cli/command-discovery.ts:registerDiscoveredCommands`).
- `cli/command-directory.ts:intakeWorkspace` returns `INTAKE_WORKSPACE`. It
  throws `INTAKE_WORKSPACE is required to create command output.` when the
  value is unset or blank.

## Global Side Effects

- The intake workspace: command directories, source state, the resolved
  property cache, the source-name mapping and the chain of data mutations are
  files under `$INTAKE_WORKSPACE`. `cli/photo/store.ts:writePersonnelPhoto`
  writes personnel photo files to
  `<workspace>/assets/PersonnelPhoto/<sha256>.<ext>`.
- The PostgreSQL database named by `DATABASE_URL`: reads during acquire,
  transform and import; writes when recorded mutations are applied, tracked in
  `public.data_mutation_applied`.
- A child process: `intake data reset` runs
  `node_modules/.bin/supabase db reset --remote=<DATABASE_URL> --no-seed --yes`
  (`cli/data/reset.ts:resetConfiguredDatabase`). This resets the schema of the
  database named by `DATABASE_URL`; it is not a recorded mutation.
- AWS Parameter Store: `cli/parameter-store-env.ts:withParameterStoreSecrets`
  reads `/policeconduct/secrets/<NAME>` through the `aws` CLI, in region
  `us-east-1`, the first time a key is needed.
  - Only the nine names in `cli/parameter-store-env.ts:PARAMETER_STORE_SECRETS`
    are read: `ANTHROPIC_API_KEY`, `CLEARING_HOUSE_API_TOKEN`,
    `COURTLISTENER_API_TOKEN`, `NEWS_INFERENCE_API_KEY`, `RESEND_API_KEY`,
    `RESEND_API_KEY_FULL_ACCESS`, `SEARCH_CONSOLE_CREDENTIALS`, `SERPAPI_KEY`
    and `YOUTUBE_API_KEY`.
  - `AWS_PROFILE`, when set, is passed to the `aws` CLI as `--profile`.
  - When the read fails it throws an error that starts with
    `Could not read <name> from Parameter Store.` and ends with the message of
    the failure. It throws `<name> in Parameter Store is empty.` when the
    value is empty or `None`.
- Other environment variables read under `cli/`:
  - `LOG_LEVEL`: the log level of the import and of the replay of database
    mutations (`cli/import/artifacts/index.ts`,
    `cli/replay/database-mutations/index.ts`).
  - `INTAKE_SHARED_IO_ROOT`: the `sharedIoRoot` written to a `Command`
    envelope when the caller supplies none; the default is
    `<cwd>/dist/shared/io`
    (`cli/command-directory.ts:createCommandDirectory`).
- Outside services called from `cli/`: the Census geocoder (import), Resend and
  Anthropic (`requests`), and a Playwright browser (`requests` portal forms).

## System Verification

- Run: `npm run test:vitest`
