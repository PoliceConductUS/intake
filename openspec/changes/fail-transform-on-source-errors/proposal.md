## Why

`data transform` with no source transforms every source in dependency order. Its help says it skips any source not yet acquired, but the code catches every error a source throws and lists it as skipped, then exits 0. A broken acquire pointer, an unreadable state folder or a defect in a source's preparation therefore looks like a source that was never acquired, and the run reports success. That hides a failure, which `AGENTS.md` forbids ("Fail fast and loudly").

## What Changes

- **Breaking:** `data transform` with no source skips only a source that has no acquired input. Any other error a source throws is listed with the source under "errored", and the command exits non-zero, as a returned transform error already does.
- `sourceInputDir` (`src/cli/transform/index.ts`) throws a named error, `NoAcquiredInputError`, when a source has no acquire pointer. The every-source loop recognises a skip by that type, not by its message.
- The summary counts the skipped sources and lists each one.
- `data transform <source>` is unchanged: a source with no acquired input still fails with the same message.

The owner chose this behaviour on 2026-11-18 (option (a) of the review of `require-an-existing-workspace`).

## Capabilities

### Modified Capabilities

- `config-driven-source-import`: adds the requirement "Transforming every source skips only a source with no acquired input".

## Impact

Affected code: `src/cli/transform/index.ts` (`sourceInputDir`, `NoAcquiredInputError`), `src/cli/data/index.ts` (the `data transform` loop with no source). Tests: `test/cli/transform/transform.integration.test.ts`.

`data update` is not changed; it still stops on a source with no acquired input.

No Supabase migration, intake source, generated type, loaded data or downstream app contract changes. No data reset or production migration plan is needed.
