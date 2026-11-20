# source-name-to-canonical-id

## Overview

The persisted source-name mapping: for a source namespace and kind, it maps a
source name to the canonical ID, and the canonical ID back to the source
name.

A mapping written by the ledger is two envelopes, one
`SourceNameToCanonicalId` and one `CanonicalIdToSourceName`. A mapping written
by `persistSourceNameToCanonicalIds`, which `seedLedgerFromIdentityMaps` uses,
is the `SourceNameToCanonicalId` envelope only. Both are in
`<workspace>/state/intake/namespaces/<namespace>/<kind>/`. The workspace is
`options.rootDir`, which every caller passes; callers take it from
`intakeWorkspace`. This file calls the mapping the
ledger, as the code does (`createSourceNameToCanonicalIdLedger`).

`restore.ts` moves a mapping back to an original canonical ID for an
`IdentityRestoration` envelope. `seed-from-identity-maps.ts` fills the ledger
from YAML identity maps.

## Interface

- `index.ts:createSourceNameToCanonicalIdLedger` - `({ rootDir })` returns a
  `SourceNameToCanonicalIdLedger`.
- `index.ts:SourceNameToCanonicalIdLedger` -
  `read(namespace, kind, sourceName)`,
  `readSourceName(namespace, kind, canonicalId)`,
  `findOrCreate(namespace, kind, sourceName, resolve?)`,
  `sourceIdFor(namespace, kind, canonicalId)`.
- `index.ts:LedgerEntityKind` - the kinds the ledger tracks.
- `index.ts:SourceNameToCanonicalIds` - the `mappings` argument of
  `persistSourceNameToCanonicalIds`: one record of source name to mapping for
  each of `locationPaths`, `agencies`, `personnel`, `agencyPersonnel` and the
  optional `licensingAuthorities`, `licenses` and `licenseActions`.
- `index.ts:AgencyMapping`, `PersonnelMapping`, `AgencyPersonnelMapping`,
  `LocationPathMapping`, `LicensingAuthorityMapping`, `LicenseMapping`,
  `LicenseActionMapping` - `{ kind?, canonicalId? }`, one type per kind.
- `index.ts:sourceLedgerRoot` - `({ rootDir })` returns
  `<rootDir>/state/intake/namespaces`.
- `index.ts:resolveSourceNameToCanonicalIdPath` - `(namespace, { rootDir })`.
- `index.ts:persistSourceNameToCanonicalIds` -
  `(namespace, mappings, { rootDir })`.
- `SourceNameToCanonicalId.ts:SourceNameToCanonicalId`,
  `CanonicalIdToSourceName.ts:CanonicalIdToSourceName` - canonical IO objects
  with `kind`, `schema`, `new`, `read` and `write`. Both files also export
  `schema` and `specSchema`.
  - `SourceNameToCanonicalId.read` takes a path or a ref, and options.
  - `CanonicalIdToSourceName.read` takes
    `(filePath, { expectedNamespace? })` only. It has no ref and no sha256
    handling.
- `ledger-record-path.ts:ledgerRecordPath` - `(directory, name, kind)`
  returns the record's file path.
- `restore.ts:assertIdentityRestorationReady`,
  `restore.ts:assertIdentityRestorationReplayable`,
  `restore.ts:assertIdentityRestorationComplete`,
  `restore.ts:completeIdentityRestoration` - `(event, rootDir)`.
- `seed-from-identity-maps.ts:seedLedgerFromIdentityMaps` -
  `(namespace, identityDir, { rootDir })` returns `SeedLedgerCounts`.

## Invariants

- `index.ts:createSourceNameToCanonicalIdLedger` - the inner `writeMapping`
  is the one place the ledger writes a mapping, and it writes both directions
  together. Two other functions write mappings without it:
  `index.ts:persistSourceNameToCanonicalIds` writes the forward record only,
  and `restore.ts:completeIdentityRestoration` writes both records itself.
- `index.ts:SourceNameToCanonicalIdLedger` - `findOrCreate` returns the
  recorded ID when one exists; otherwise it writes a new cuid2, or the result
  of `resolve`, before it returns.
- `index.ts:createSourceNameToCanonicalIdLedger` - a read throws when the
  envelope's `spec.kind` differs from the expected kind.
- `index.ts:resolveSourceNameToCanonicalIdPath` - throws on an invalid
  namespace (`assertValidSourceId`).
- `index.ts:mappingRecordExists` - throws
  `SourceNameToCanonicalId path is not a file: <path>`; a missing path returns
  `false`. Not exported; used by the ledger's `read` and `readSourceName`.
- `SourceNameToCanonicalId.ts:schema` - `.strict()` on the envelope,
  `metadata` and `spec`.
- `SourceNameToCanonicalId.ts:readSourceNameToCanonicalId` - throws on a
  `ref.kind` mismatch, a sha256 mismatch and a namespace mismatch.
- `CanonicalIdToSourceName.ts:schema` - `.strict()` on the envelope,
  `metadata` and `spec`.
- `CanonicalIdToSourceName.ts:readCanonicalIdToSourceName` - throws on a
  namespace mismatch. Not exported; it is `CanonicalIdToSourceName.read`.
- `ledger-record-path.ts:ledgerRecordPath` - a name that is an `http` or
  `https` URL uses `%url-<digest>.<kind>.yaml` when the ordinary file name is
  longer than 255 bytes, when it collides by case, or when the ordinary file
  is absent and the digest file exists.
- `restore.ts:readState` - not exported; all four exported functions call it
  first. It throws:
  - `Identity restoration erroneous ID is owned by another namespace: <namespace>.`
    when another namespace has a `CanonicalIdToSourceName` record for the
    expected current ID.
  - `Identity restoration mapping is missing.` when the namespace has no
    `SourceNameToCanonicalId` record for the source name.
  - `Identity restoration mapping does not match expected identity.` when
    that record's name or kind differs, or its canonical ID is neither the
    expected current ID nor the original ID.
  - `Identity restoration original or current identity is occupied by another source.`
    when a `CanonicalIdToSourceName` record of either ID names another source
    name, kind or ID.
- `restore.ts:assertIdentityRestorationReady` - throws unless the expected
  current mapping exists and the original identity is unoccupied.
- `restore.ts:assertIdentityRestorationComplete` - throws
  `Identity restoration ledger is incomplete; run data up to recover.`
- `seed-from-identity-maps.ts:readIdentityMap` - throws
  `<path>: mapping <key> has no canonical ID; expected a non-blank string or a number.`
  when a mapping's value is blank or is not a string or a number; a missing
  map file throws from `readFile`. Not exported.

## Side Effects

- `index.ts:createSourceNameToCanonicalIdLedger` - `read` reads one record
  file. `readSourceName` reads one record file, or answers from the ledger's
  in-memory reverse cache when the canonical ID was read or written before.
  `findOrCreate` and `sourceIdFor` write a `SourceNameToCanonicalId` file and
  a `CanonicalIdToSourceName` file on a miss.
- `ledger-record-path.ts:ledgerRecordPath` - for a URL name, calls `realpath`
  on the ordinary path and, when that is absent, on the digest path.
- `restore.ts:readState` - lists every namespace directory under
  `<workspace>/state/intake/namespaces`, at every depth, and reads the
  `SourceNameToCanonicalId` and `CanonicalIdToSourceName` records it checks.
- `index.ts:persistSourceNameToCanonicalIds` - creates seven kind
  directories (`LocationPath`, `Agency`, `Personnel`, `AgencyPersonnel`,
  `LicensingAuthority`, `License`, `LicenseAction`) and writes one
  `SourceNameToCanonicalId` file per mapping.
- `restore.ts:completeIdentityRestoration` - writes the new forward and
  reverse records to a staging directory, renames them into place, and
  removes the record of the old ID.
- `seed-from-identity-maps.ts:seedLedgerFromIdentityMaps` - reads
  `agencies.yaml`, `personnel.yaml` and `agency-officers.yaml` from
  `identityDir`; existing records for the same keys are overwritten. It
  writes through `persistSourceNameToCanonicalIds`.

## Verification

- Run: `npx vitest run test/cli/state/source-name-to-canonical-id.test.ts test/cli/state/seed-from-identity-maps.test.ts test/cli/state/identity-restoration.test.ts`
