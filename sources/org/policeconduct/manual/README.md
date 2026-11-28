# org/policeconduct/manual

## Overview

Intake source for records a curator enters by hand. Acquire takes one record of
a handled record kind, either from the `MANUAL_KIND` and `MANUAL_RECORD`
environment values or from an interview on stdin whose prompts come from the
generated `<Kind>Spec` and `FK_REFERENCES`, validates it against that spec, and
adds it to the sha-chained manual output in the source's state folder, where it
replaces an entry with the same kind and identity value. Transform reads the
latest manual output and returns its entries as artifacts grouped by import
artifact kind. The source is declared `standalone: true`.

## Interface

- `intake.source.ts:source` - the `IntakeSource` object:
  `{ produces: PRODUCES, standalone: true, acquire, transform }`.
- `acquire.ts:acquire` - `SourceAcquire`,
  `async ({ state, env, logger }) => Promise<void>`. Obtains `{ kind, record }`,
  validates the record, and adds it with `chain.ts:appendEntry`.
- `transform.ts:transform` - `SourceTransform`,
  `async ({ state }) => Promise<SourceManifest>`. Returns one artifact for each
  import artifact kind that has at least one entry, each record stored as
  `{ spec: entry.record }`, and one row accounting entry for the input
  `manual records`. An empty manual output returns `artifacts: []` and an
  accounting entry of zero rows.
- `kinds.ts:HANDLED_RECORD_KINDS` - the 13 record kinds the interview offers.
- `kinds.ts:artifactKindFor` - `(recordKind: string) => ImportArtifactKind`. The
  import artifact kind whose `importTypeMetadata` record kind matches.
- `kinds.ts:PRODUCES` - `HANDLED_RECORD_KINDS` mapped through `artifactKindFor`,
  computed when the module loads.
- `entity-model.ts:ManualField` - type
  `{ name: string; optional: boolean; targetKind?: string }`, one field the
  interview prompts for.
- `entity-model.ts:KindModel` - type
  `{ recordKind: string; identity: string; fields: ManualField[] }`.
- `entity-model.ts:describeKind` - `(recordKind: string) => KindModel`. Built
  from the generated `<recordKind>Spec`, `FK_REFERENCES`, and
  `identityColumnForKind`.
- `entity-model.ts:parseRecord` -
  `(recordKind, record) => Record<string, unknown>`. Returns
  `spec.parse(record)` for the generated `<recordKind>Spec`.
- `chain.ts:readLatest`, `chain.ts:appendEntry`, `chain.ts:ManualEntry`,
  `chain.ts:ManualOutput` - re-exports from `src/cli/state/manual-records.ts`.
  - `readLatest` - `(stateDir) => Promise<ManualOutput>`. The output that
    `latest.json` points to.
  - `appendEntry` - `(stateDir, entry, identity) => Promise<ManualOutput>`.
    Writes the next output and moves `latest.json` to it.

## Invariants

- `acquire.ts:acquire` requires the kind to be in `kinds.ts:HANDLED_RECORD_KINDS`
  and otherwise throws
  `org/policeconduct/manual: kind <kind> is not handled (<handled kinds>).`
  `acquire.ts:requireHandledKind` (not exported) makes the check as soon as the
  kind is known: on `env.MANUAL_KIND` before `MANUAL_RECORD` is parsed, and in
  the interview on the typed kind before the first field prompt.
- `acquire.ts:acquire` skips the interview only when both `env.MANUAL_KIND` and
  `env.MANUAL_RECORD` are defined; `MANUAL_RECORD` is parsed as JSON.
- `acquire.ts:acquire` validates the record with `entity-model.ts:parseRecord`
  before `chain.ts:appendEntry`, and passes the parsed record to it.
- `acquire.ts:interview` (not exported) leaves blank answers out of the record
  and stores every other answer as a trimmed string. A foreign-key field is
  prompted as `<field> [<targetKind> source id]` and its answer is stored as
  typed; it is not resolved or checked during acquire.
- `chain.ts:appendEntry` replaces an existing entry that has the same kind and
  the same identity value (or, when the record has no identity value, the same
  record JSON), and sorts the entries by that key. Each output file is named by
  the sha256 of its content and holds the path and sha256 of the previous
  output.
- `chain.ts:readLatest` throws
  `org/policeconduct/manual: <path> sha mismatch (edited out of band); expected <sha>.`
  when the output file does not have the sha256 that `latest.json` records. It
  returns `{ previous: null, entries: [] }` only when `latest.json` is missing.
  Any other read error is rethrown, and a `latest.json` that is not JSON throws
  `<path> is not valid JSON: <message>`.
- `entity-model.ts:describeKind` and `entity-model.ts:parseRecord` throw
  `org/policeconduct/manual: no shared spec for kind <recordKind>` when the
  generated `<recordKind>Spec` is not a zod object.
- `kinds.ts:artifactKindFor` throws
  `org/policeconduct/manual: no artifact kind produces record kind <recordKind>`
  when no import artifact kind carries the record kind. Because
  `kinds.ts:PRODUCES` is computed at module load, importing `kinds.ts` throws in
  that case.
- `kinds.ts:HANDLED_RECORD_KINDS` is a static list; its comment states that a
  source's `produces` must be static for run ordering (ADR 0031).
- `transform.ts:transform` keys each record by the value of the kind's identity
  column, or by the JSON of the whole record when that value is missing. That
  is the key `chain.ts:appendEntry` removes repeats by, so two entries of one
  kind never share a key.
- `transform.ts:transform` states its row accounting for the input
  `manual records`: every entry of the latest manual output is counted as read
  when the loop reaches it and as emitted when its record is stored. The source
  reports no finding and leaves no entry out, so `reported` is 0 and
  `notSelected` is empty.

## Side Effects

- `acquire.ts:acquire` - reads `env.MANUAL_KIND` and `env.MANUAL_RECORD` from
  the `env` it is given.
- `acquire.ts:interview` (not exported) - prompts on `process.stdout` and reads answers from
  `process.stdin` through `node:readline/promises`.
- `acquire.ts:acquire` - files, through `chain.ts:appendEntry`: creates
  `<state>/manual`, reads `<state>/manual/latest.json` and the output it points
  to, writes a new `<state>/manual/<sha256>.json` and rewrites
  `<state>/manual/latest.json`.
- `acquire.ts:acquire` - logging through `logger?.info`.
- `transform.ts:transform` - files, through `chain.ts:readLatest`: reads
  `<state>/manual/latest.json` and the output it points to. Transform writes
  nothing.

## Verification

- Run: `npx vitest run test/sources/org/policeconduct/manual`
