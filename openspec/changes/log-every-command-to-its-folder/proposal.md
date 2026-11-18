## Why

Only `data generate` and the replay of database mutations write a log file. `data acquire`, `data transform` and `data reset` print their progress to the terminal and keep nothing. Of the 190 command folders in the dev workspace, 18 have a log, all from `data generate`. The CourtListener acquire of 2026-11-17 stopped with no completion record, no output and no error anywhere on disk, so the cause cannot be found. A full CourtListener acquire runs for hours unattended; when it stops, its folder must hold the progress it made and the reason it stopped.

ADR 0013 (`docs/adr/0013-preserve-command-auditability.md`) makes the command folder the audit unit and requires a structured `<command-name>.log` in it. The accepted requirement "Import Logging And Progress" in `openspec/specs/artifacts-database-import/spec.md` applies that rule to the import that `data generate` runs. This change applies it to every command that creates a command folder, and brings both documents up to the current folder path and command names.

## What Changes

- A command folder is the folder `createCommandDirectory` (`src/cli/command-directory.ts`) creates for one run: `$INTAKE_WORKSPACE/command/<timestamp>-<command-name>/`, where `<command-name>` is that folder's own cuid2 command name. Every command that creates one writes `<command-name>.log` in it, as pino JSON records at the level `LOG_LEVEL` names (default `info`):
  - `data acquire`, with and without `--from-local`: one command folder and log for each source acquired.
  - `data transform`: one command folder and log for each source transformed, including the transforms that `data update` and `data reset` run.
  - `data reset`: a log in the reset's own command folder.
  - `cache set`, `cache unset`, `cache alias` and `photo import`.
  - `data generate` and `replay database-mutations`, which already write one, now open it the same way.
- The log holds each progress line the command or its source writes through it. One pino logger writes each record to the file synchronously and prints each record's `msg` to the command's terminal stream: stderr for acquire, transform and reset, stdout for replay, none for `data generate`, `cache` and `photo import`. A record without a `msg` goes only to the file.
- When a command fails with an error it catches, the last record is that error, serialized by pino with its message and stack, and with no `msg`. `data generate` and `replay database-mutations` record their errors the same way, so every command folder holds one shape of error record.
- Each command closes its log when it ends, success or failure.
- The CLI entry point (`src/cli/index.ts`) watches the process. When it receives `SIGINT` or `SIGTERM`, exits while a command log is still open (through `process.exit`, or because a promise never settled), or ends on an uncaught exception or unhandled rejection, a final record naming the signal, the exit code or the error is written to each command log still open, and the process then ends as it would have.
- An unknown `LOG_LEVEL`, or an empty one, fails the command before its command folder is created, with a message naming the value. One level still filters the terminal and the log together.
- Before a record is written, each Parameter Store secret value the command has read (the names in `PARAMETER_STORE_SECRETS`) is replaced by `[redacted]` wherever it appears in the record.
- With `LOG_LEVEL` unset or at `info`, the terminal output does not change: progress lines still go to their stream, and the command's own result output (its final stdout, or its final stderr message on failure) stays out of its log. A reset records the final stdout of each `data` command it runs.
- A test in `test/architecture.test.ts` requires every caller of `createCommandDirectory` to open a command log.
- ADR 0013 and the accepted requirement "Import Logging And Progress" name the current command-folder path and commands.

## Non-Goals And Risks

This change accepts these limits:

- A process killed by `SIGKILL` or by the operating system (for example, out of memory) cannot run a handler, so its log ends at the last record it wrote.
- A command that fails before it creates its command folder (for example, a `cache set` value that does not validate, or `data reset` without `DATABASE_URL`) leaves no folder and no log, as before; one that fails while writing its `Command` envelope leaves a folder with no log. ADR 0013 asks for a command folder even for a command that fails validation, and for one command name for each execution where a reset gives each folder its own name; this change does not close those gaps.
- Commands that create no command folder write no log; `cache get` and `data up` are two. The lines `data up` prints while a reset runs it, the lines `data update` prints while it applies mutations, the per-source lines the `data transform` (no source) and `data update` loops print, and the output of `supabase db reset` during a reset are printed only.
- At `LOG_LEVEL` `warn` or above, progress lines are neither printed nor logged; at `fatal` or `silent`, the error record is dropped too.
- Only secret values are redacted. Other data an error carries is written as it is. The final stderr message, which is not a record, is not redacted. Logs have no size limit; each holds one run.
- A failed reset's error record does not name the phase where it stopped; the last `data reset:` progress line before it does, except for the inventory of acquisitions, the scan for the last `LocationPaths` producer and the retirement of previous mutations, which print no line before they run.
- `cache set`, `cache unset`, `cache alias` and `photo import` print no progress lines, so their log is empty when they succeed.

## Alternatives Considered

- Open the log inside `createCommandDirectory`: not chosen. The callers pass different terminal streams, and each must close its log when its command ends; the architecture test keeps every caller opening one.
- Capture all terminal output at the CLI entry point: not chosen. It would write plain text, not the structured pino records ADR 0013 requires, and it could not tell which command folder a line belongs to when one run creates several.

## Capabilities

### New Capabilities

- `command-logs`: which commands write a log, where, what it holds, and how it ends.

### Modified Capabilities

- `artifacts-database-import`: "Import Logging And Progress" names `data generate` and `replay database-mutations`, the current command-folder path, and the error record.

## Impact

Affected code:

- `src/logging.ts`: `createCommandLog`, `recordCommandError`, closing a command log, the record of a process end, `LOG_LEVEL` validation and secret redaction.
- `src/cli/index.ts`: the process handlers.
- `src/cli/command-directory.ts`: rejects an unknown `LOG_LEVEL` before creating the folder.
- `src/cli/acquire/index.ts`, `src/cli/acquire/acquire-from-local.ts`, `src/cli/transform/index.ts`, `src/cli/data/index.ts`, `src/cli/data/source-pipeline.ts`, `src/cli/data/reset.ts`, `src/cli/cache/index.ts`, `src/cli/photo/index.ts`, `src/cli/import/artifacts/index.ts`, `src/cli/import/artifacts/config.ts`, `src/cli/replay/database-mutations/index.ts` and `src/cli/replay/database-mutations/config.ts`: open, use and close the command log. `acquireSource`, `acquireFromLocal`, `transformOneSource`, `buildTransformSourceDeps` and `resetData` take a `terminal` stream in place of a `logger`. The import and replay results carry the `Error`, not only its message.
- Tests for each, the shared helper `test/cli/command-log.ts`, and `test/architecture.test.ts`.
- `docs/adr/0013-preserve-command-auditability.md`.

Secret redaction needs `PARAMETER_STORE_SECRETS` and `withParameterStoreSecrets` from `src/cli/parameter-store-env.ts`, which exist only on `feat/parameter-store-secrets`. It is implemented when that code reaches this branch.

Intake sources: the `logger` a source's acquire or transform receives keeps its interface. Its lines now also go to the command's log, and `LOG_LEVEL` filters them.

No Supabase migration, generated type, loaded data or downstream app contract changes. No data reset or production migration plan is needed.
