# gov/sc/sccja

## Overview

Source namespace `gov/sc/sccja`: the public-records request definition for the South Carolina Law Enforcement Training Council. The source declares no acquire and no transform, so it produces no artifacts.

## Interface

- `intake.source.ts:source` - the `IntakeSource` for this namespace. It carries a `description` and a `request` with `agency`, `state`, `scope`, a portal `channel`, and one `historical` submission entry with a checked-in `id`. It also carries a `portalForm` with the form `url`, the ordered `fill` and `click` `actions`, the `submit` target, the `successText`, and an empty `blockers` list.

## Invariants

- `intake.source.ts:source` is checked with `satisfies IntakeSource`. `src/cli/intake-source.ts:IntakeSource` requires `transform` and `produces` to appear together; this source declares neither.

## Side Effects

- None. `intake.source.ts:source` is a constant and the module runs no code on import.

## Verification

- Run: `npm run test:vitest`
