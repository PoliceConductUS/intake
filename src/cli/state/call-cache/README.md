# call-cache

## Overview

The cache of call results and files (ADR 0039). A call result is one
`CallResult` envelope under
`<workspace>/state/intake/namespaces/<namespace>/CallResult/`, named by the
fingerprint of its request. A file is one `BinaryFile` envelope under
`<workspace>/state/intake/namespaces/<namespace>/BinaryFile/`, named by the
SHA-256 of the file, with the file beside it as `<sha256>.<extension>`.
`<namespace>` is the namespace of the source whose acquire or record asked.

`index.ts` is the read and write adapter. The canonical IO for the two kinds
is `src/shared/io/CallResult.ts` and `src/shared/io/BinaryFile.ts`. The
service clients in `src/shared/services/` are the only callers; they reach
this store through `createCallCache`.

## Interface

- `index.ts:CallCacheLocation` - `{ rootDir, namespace }`; `rootDir` is the
  workspace.
- `index.ts:readCallResult` - `(location, request)` returns the
  `CallResultEnvelope` for the request, or `undefined`.
- `index.ts:appendOutcome` - `(location, request, outcome)` adds the outcome
  after the earlier ones and returns the envelope.
- `index.ts:standingOutcome` - `(envelope, now, { keepSucceeded }?)` returns
  the outcome that stands, or `undefined` when the call must be made.
- `index.ts:readBinaryFile` - `(location, sha256)` returns
  `{ envelope, bytes, filePath }`, or `undefined`.
- `index.ts:writeBinaryFile` -
  `(location, { bytes, contentType, extension, origin })` returns
  `{ envelope, bytes, filePath }`.
- `index.ts:createCallCache` - `({ rootDir, namespace, keepSucceeded? })`
  returns the `CallCache` of `src/shared/services/client-base.ts`: the five
  functions above bound to that location, with `keepSucceeded` applied by
  `standingOutcome`.

## Invariants

- `index.ts:standingOutcome` - no envelope: `undefined`. The last outcome is
  the current one. A current outcome with no `retryAfter` stands. A current
  outcome stands while `now` is before its `retryAfter`, and no longer at or
  after it. The rule is the same for a succeeded and a failed outcome. With
  `keepSucceeded`, the last succeeded outcome stands whatever its
  `retryAfter` and whatever came after it; an envelope with no succeeded
  outcome follows the ordinary rule.
- `index.ts:readCallResult`, `index.ts:readBinaryFile` - throw when the
  envelope's `metadata.namespace` is not the location's namespace. The
  namespace must pass `assertValidSourceId`.
- `index.ts:readBinaryFile` - throws `Not a SHA-256: <value>`; throws
  `BinaryFile file has no envelope: <path>` when a file named `<sha256>.*` is
  there without its envelope; and throws what `BinaryFile.read` throws for an
  envelope without its file or a file that does not hash to its name.
- `index.ts:writeBinaryFile` - the same bytes are stored once: a second write
  returns the first envelope unchanged, whatever origin, content type or
  extension it was given. It throws
  `BinaryFile name is taken by different bytes: <path>` and writes nothing
  when the name is held by other bytes.

## Side Effects

- `index.ts:readCallResult`, `index.ts:readBinaryFile` - read files under the
  two directories above.
- `index.ts:appendOutcome` - reads the envelope and writes it back with the
  new outcome.
- `index.ts:writeBinaryFile` - writes the file, then its envelope, each to a
  `.tmp` name that is then renamed.

## Verification

- Run: `npx vitest run test/cli/state/call-cache.test.ts test/shared/io/call-result.test.ts test/shared/io/binary-file.test.ts`
