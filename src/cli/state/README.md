# state

## Overview

State that outlives one command. The files in this directory keep per-source
state in the source's state directory, `<workspace>/state/<source-id>/`: the
command pointer, the manual records and the transform completion record. The
subdirectories hold the resolved property cache and the source-name mapping.

It registers no CLI command.

## Interface

- `command-pointer.ts:readCommandPointer` - `(statePath, command)` returns a
  `CommandPointer`: `{ resume?, latest? }`.
- `command-pointer.ts:writeCommandPointer` - `(statePath, command, pointer)`.
- `manual-records.ts:readLatest` - `(stateDir)` returns the latest
  `ManualOutput`: `{ previous, entries }`.
- `manual-records.ts:appendEntry` - `(stateDir, entry, identity)` returns the
  new `ManualOutput`.
- `manual-records.ts:ManualEntry` - `{ kind, record }`.
- `transform-completion.ts:beginTransform` - `(state)`.
- `transform-completion.ts:snapshotInput` - `(workspace, state, standalone)`
  returns `{ directory, digest }`, or `null` for a standalone source.
- `transform-completion.ts:completeTransform` -
  `(state, artifactsPath, input)`.
- `transform-completion.ts:requireTransformCompletion` -
  `(workspace, sourceId, artifactsPath?)` returns the recorded `Artifacts`
  path.
- `transform-completion.ts:directoryDigest` - `(directory)` returns a sha256
  over the relative path and bytes of every file below the directory. An entry
  whose name starts with `.` is skipped, file or directory.
- [resolved-property](./resolved-property/README.md) - the cache of resolved
  properties, one `ResolvedProperty` envelope per subject and property.
- [call-cache](./call-cache/README.md) - the cache of call results and files,
  one `CallResult` envelope per request and one `BinaryFile` envelope per
  file content.
- [source-name-to-canonical-id](./source-name-to-canonical-id/README.md) -
  the mapping from a source name to its canonical ID, and back.

## Invariants

- `command-pointer.ts:readCommandPointer` - throws when the pointer is not an
  object or when `resume` or `latest` is not a string. A missing file returns
  an empty pointer.
- `manual-records.ts:readLatest` - throws on a sha256 mismatch between
  `latest.json` and the output it names. It returns an empty chain,
  `{ previous: null, entries: [] }`, only when `latest.json` is missing.
  `manual-records.ts:readJson` (not exported) throws any other read error, and
  throws `<path> is not valid JSON: <parser message>` on a parse error.
- `manual-records.ts:appendEntry` - each output names the previous output's
  path and sha256; an entry with the same kind and identity value replaces the
  earlier one. When the record has no value in the identity column, the whole
  record as JSON takes the place of the identity value. The entries are stored
  sorted by kind and that value.
- `transform-completion.ts:snapshotInput` - throws
  `No completed acquisition for transform.` when the acquire pointer has no
  `latest`.
- `transform-completion.ts:completeTransform` - throws
  `Acquired input changed during transform.` when the input digest changed.
- `transform-completion.ts:requireTransformCompletion` - calls
  `assertValidSourceId(sourceId)` first. It throws when no completed transform
  is recorded, when the `Artifacts` path differs, when the acquired input
  changed, and when the `Artifacts` changed since the transform. A missing
  record, a record that is not valid JSON and a record that fails its schema
  all throw the same `No recorded successful transform for <sourceId>` error.
- `transform-completion.ts:directoryDigest` - throws on an entry that is
  neither a file nor a directory.

## Side Effects

- `command-pointer.ts:writeCommandPointer` - creates `statePath` and writes
  `<statePath>/<command>.yaml`. An empty or absent `latest` or `resume` is
  left out of the file.
- `command-pointer.ts:readCommandPointer` - reads that file.
- `manual-records.ts:appendEntry` - writes `<stateDir>/manual/<sha256>.json`
  and `<stateDir>/manual/latest.json`.
- `manual-records.ts:readLatest` - reads those files.
- `transform-completion.ts:beginTransform` - creates `state` and writes
  `<state>/transform-completion.json`.
- `transform-completion.ts:snapshotInput` - for a source that is not
  standalone, reads `<state>/acquire.yaml` and every file under the acquired
  directory it names.
- `transform-completion.ts:completeTransform` - writes that file and reads
  the input directory and the `Artifacts` to compute digests.
- `transform-completion.ts:requireTransformCompletion` - reads
  `<workspace>/state/<sourceId>/transform-completion.json`, the acquired
  input and the `Artifacts`.

## Verification

- Run: `npx vitest run test/cli/state`
