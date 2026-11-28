# gov/az/post/roster

## Overview

Source namespace `gov/az/post/roster`: the Arizona POST roster source. It is disabled. Its transform is a no-op, because the roster so far yields only Personnel with no agency link. The comment in `transform.ts` records what re-enabling needs: AgencyPersonnel and the Agency records they reference, emitted alongside Personnel.

## Interface

- `intake.source.ts:source` - the `IntakeSource` for this namespace: a `description`, an empty `produces` list, and `transform`.
- `transform.ts:transform` - a `SourceTransform` that takes no input and resolves to `{ artifacts: [], accounting: [] }`.

## Invariants

- `intake.source.ts:source` declares `produces: []`, and `transform.ts:transform` returns no artifacts, so the two agree that this source emits nothing.
- `transform.ts:transform` reads no input, not even the paths it is given, so its row accounting is the empty list.
- `intake.source.ts:source` is checked with `satisfies IntakeSource`. `src/cli/intake-source.ts:IntakeSource` requires `transform` and `produces` to appear together.

## Side Effects

- None. `transform.ts:transform` reads no input and writes nothing.

## Verification

- Run: `npx vitest run test/sources/gov/az/post/roster/intake.source.test.ts`
