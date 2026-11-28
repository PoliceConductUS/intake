# sources

## Overview

Registers `sources`, which lists every source under `sources/` with its
description and supported operations, and a `produces:` and a `consumes:`
line when the source has those kinds. It also registers
`sources daily <source>`, which runs a source's `daily` function.

## Interface

- `index.ts:registerCliCommand` - `(program, dependencies)`; registers
  `sources` and `sources daily <source>`.

## Invariants

- `index.ts:registerCliCommand` - `sources daily` throws
  `Source <id> does not support daily` when the source exports no `daily`.
- `index.ts:registerCliCommand` - `sources daily` does not catch errors. The
  `does not support daily` error and any error from `loadIntakeSource` or
  from `daily` leave the action as a thrown error, with no `setResult`, and
  `runIntake` rethrows it.

## Side Effects

- `index.ts:registerCliCommand` - `describeSources` and `loadIntakeSource`
  read and import the `intake.source.ts` modules under `<cwd>/sources`;
  `sources daily` runs the source's `daily` function with
  `withParameterStoreSecrets(process.env)`, so the API keys it reads come from
  Parameter Store.

## Verification

- Run: `npx vitest run test/cli/describe-sources.test.ts test/cli/sources/daily-secrets.test.ts`
