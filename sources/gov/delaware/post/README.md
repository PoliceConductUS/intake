# gov/delaware/post

## Overview

Source namespace `gov/delaware/post`: the public-records request definition for the Delaware Police Officer Standards and Training Commission. The source declares no acquire and no transform, so it produces no artifacts.

## Interface

- `intake.source.ts:source` - the `IntakeSource` for this namespace. It carries a `description` and a `request` with `agency`, `state`, `scope`, an email `channel`, and one `historical` submission entry with a checked-in `id`.

## Invariants

- `intake.source.ts:source` is checked with `satisfies IntakeSource`. `src/cli/intake-source.ts:IntakeSource` requires `transform` and `produces` to appear together; this source declares neither.

## Side Effects

- None. `intake.source.ts:source` is a constant and the module runs no code on import.

## Verification

- Run: `npm run test:vitest`
