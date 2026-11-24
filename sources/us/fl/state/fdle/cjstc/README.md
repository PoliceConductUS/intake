# us/fl/state/fdle/cjstc

## Overview

Intake source declaration for Florida's Criminal Justice Standards & Training
Commission (source namespace `us/fl/state/fdle/cjstc`). The folder holds only
`intake.source.ts`, which describes the source and its public-records
`request`. It declares no acquire phase, no transform phase and no `produces`.

## Interface

- `intake.source.ts:source` - the `IntakeSource` declaration, with:
  - `description` - "Florida Criminal Justice Standards & Training Commission
    public-records requests".
  - `request.agency`, `request.state`, `request.scope` - the commission,
    Florida, and statewide agency and officer records.
  - `request.channel` - `type: "email"`, with the `to` address and the
    `sourceUrl` it was taken from.
  - `request.historical` - one request already submitted on `2026-10-23` with
    `transport: "portal"`, `reference: "GRR-2026-5434"`, an `evidence` pointer
    and `notes`.

## Invariants

- `intake.source.ts:source` - `satisfies IntakeSource` is a compile-time check.
  The [`IntakeSource`](../../../../../../src/cli/intake-source.ts) type does
  not allow `produces` on a source that has no `transform`.
- `intake.source.ts:source` - the `request.historical` entry has a checked-in
  literal `id`.
- `intake.source.ts:source` - the `request.historical` `notes` say "Do not
  duplicate request." and that receipt of the attachment "remains unverified".
  This is recorded data; no code in this folder enforces it.

## Side Effects

- None. `intake.source.ts` has one type-only import and one constant.

## Verification

- Run: `npm run test:vitest` (no test file under `test/sources` matches this
  source).
