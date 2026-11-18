## Implementation

- [x] `src/logging.ts`: add `createCommandLog` (opens `<command-name>.log` in a command folder through `createIntakeLog` at `LOG_LEVEL`) and `recordCommandError` (writes the error record with no `msg`).
- [x] `data acquire` (with and without `--from-local`): open the command's log, pass its logger to the source, and record a caught error as the last record. Tests in `test/cli/acquire/acquire-command.test.ts` and `test/cli/acquire/acquire-from-local.test.ts` assert the progress lines and the error record.
- [x] `data transform`, including the transforms `data update` and `data reset` run: the same. Test in `test/cli/transform/transform-command.test.ts` asserts that a source's progress line is printed and logged and that a failed run's log ends with its error.
- [x] `data reset`: the same for the reset's own command folder. Tests in `test/cli/data/reset.test.ts`.
- [x] `cache set`, `cache unset`, `cache alias` and `photo import`: open the command's log with no terminal stream and record a caught error. Tests: `cache set` writes a log and records its error (`test/cli/cache.test.ts`); `cache alias` writes a log (`test/cli/cache-alias.test.ts`); `photo import` writes a log and records its error (`test/cli/personnel-photo.test.ts`).
- [x] `createCommandDirectory`: reject an unknown or empty `LOG_LEVEL`, naming the value, before creating the folder. Test in `test/cli/command-directory.test.ts`.
- [x] Close each command's log when the command ends, in every command that opens one. Tests: a closed log takes no more records (`test/logging.test.ts`), and each command's log tests assert the log is closed when the command returns.
- [x] `src/cli/index.ts`: on `SIGINT`, `SIGTERM`, a process exit with a log still open, an uncaught exception or an unhandled rejection, write a final record to each open command log, then end the process as it would have ended. Tests drive the handlers with a stand-in process (`test/logging.test.ts`).
- [x] `data generate` and `replay database-mutations`: open their log with `createCommandLog`, close it when they end, and record a failure with `recordCommandError`; the import and replay results carry the `Error`. Tests in `test/import/artifacts-command.test.ts`; the tests that read an import or replay error now read its `message`.
- [x] `test/architecture.test.ts`: every module that calls `createCommandDirectory` also calls `createCommandLog`.
- [ ] Redact each Parameter Store secret value the command has read from every record, as `[redacted]`. Blocked: it needs `PARAMETER_STORE_SECRETS` and `withParameterStoreSecrets` from `src/cli/parameter-store-env.ts`, which exist only on `feat/parameter-store-secrets`.
- [ ] Add the missing tests, each reading the log with `readLogRecords` from `test/cli/command-log.ts`:
  - [x] `test/cli/cache.test.ts`: `cache unset` writes a log and records its error.
  - [x] `test/cli/cache-alias.test.ts`: `cache alias` records its error.
  - [x] `test/cli/acquire/acquire-command.test.ts`: a record is in the file before the source continues; a failed acquire ends its log with its error.
  - [ ] An acquire of several sources writes a log in each folder. Not written: the `data acquire` command reads sources only from `sources/` in the working directory, so a test of its loop would run real acquires.
  - [x] `test/cli/transform/transform-command.test.ts`: a transform logs its exclusion lines and records an undeclared-kind error.
  - [x] `test/cli/data/update-initial-roots.test.ts`: `data update` runs each source's transform with stderr as its terminal.
  - [x] `test/cli/data/reset.test.ts`: a reset logs the final stdout of the `data` commands it runs.
  - [x] `test/cli/data/reset.integration.test.ts`: every command folder a reset creates holds its own log, except the transforms the test itself stands in for; the folders include the reset, a `data generate` and the manual transforms. The test runs no acquire.
  - [x] `test/cli/acquire/acquire-command.test.ts`: `LOG_LEVEL` `warn` hides progress lines from the terminal and the log, and `info`, `debug` and `trace` print and log them.
- [x] `docs/adr/0013-preserve-command-auditability.md`: name the current command-folder path, output folder and state path, and the log's end records.
- [x] READMEs: on this branch no README under `src/` exists, and the root `README.md` does not describe command folders or logs, so no README changed.

## Merge with `feat/parameter-store-secrets`

- [ ] Resolve the code both branches change. There, `acquireFromLocal` logs left-out dotfiles through `deps.logger` before the command folder exists and passes `deps.logger` to `buildServiceClients`; `acquireSource` passes `deps.logger` to `buildServiceClients`; `transformSource` logs its exclusions and totals through `deps.logger` and returns, not throws, on an undeclared kind. This branch removes that `deps.logger`, opens the command's log instead, and throws on an undeclared kind so the error is recorded. The merge also meets that branch's `keepCachedCallResults` in `src/cli/data/reset.ts` and `options.logger` in `buildTransformSourceDeps`.
- [ ] `acquireFromLocal`: create the command folder and open its log before resolving the `--from-local` inputs, so the left-out dotfile lines are progress lines in the log.
- [ ] `acquireSource`: write the service-skip lines as progress lines through the command's log.
- [ ] Implement the secret redaction task above.
- [ ] Update the `src/` READMEs that commit `ca162ab` on that branch adds: list `createCommandLog`, `recordCommandError` and `CommandLogger`, and the export of `TerminalStream`, in `src/README.md`; state the command log, and correct each passage that describes the removed `logger` dependency or says `LOG_LEVEL` applies only to the import and the replay, in `src/README.md`, `src/cli/README.md` and the READMEs of `src/cli/acquire`, `src/cli/transform`, `src/cli/data`, `src/cli/cache` and `src/cli/photo`.

## Validate

- [x] Run `npm run validate`, including OpenSpec validation, after the first implementation. No Supabase migration or loaded data changes, so no Supabase validation or integrity assertions apply.
- [x] Run `npm run validate` again after the owner decisions of 2026-11-18 are implemented.
- [ ] Run one acquire of any source on the dev workspace (`~/dev/PoliceConductUS/intake-workspace/`) with `LOG_LEVEL` unset. Assert that its command folder holds `<command-name>.log` and that the `msg` values of its records appear, in the same order, among the lines the acquire printed to stderr.
