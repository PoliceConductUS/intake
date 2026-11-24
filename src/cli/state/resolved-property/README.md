# resolved-property

## Overview

The cache of resolved properties. Each resolved property is one
`ResolvedProperty` envelope under
`<workspace>/state/intake/namespaces/intake/ResolvedProperty/`, named from
`apiVersion:kind:name:targetProperty` of its subject.

An envelope holds a list of entries. An entry with an `inputFingerprint` is a
value resolved from that typed input. An entry without one is returned by
`readResolvedProperty` before any other entry. Such an entry is a manual value
when it carries a `commandId`; a resolver that passes no fingerprint, such as
the slug resolver, writes one without a `commandId`.

`ResolvedProperty.ts` is the canonical IO for the kind. `index.ts` is the read
and write adapter used by the import and by the `cache` command.

## Interface

- `ResolvedProperty.ts:ResolvedProperty` -
  `{ kind, schema, new, read(pathOrRef, options?), write(directory, envelope, options?) }`.
- `ResolvedProperty.ts:schema`, `ResolvedProperty.ts:specSchema` - envelope
  and spec schemas; types `ResolvedPropertyEnvelope` and
  `ResolvedPropertyInput`.
- `index.ts:ResolvedPropertyCacheInput` - `subject`, `targetProperty`,
  optional `inputFingerprint` and `getLocationPathById`.
- `index.ts:ResolvedPropertySubject`, `index.ts:ResolvedPropertySource` -
  subject and source types.
- `index.ts:resolvedPropertyCacheName` - `(input)` returns
  `apiVersion:kind:name:targetProperty`.
- `index.ts:inspectResolvedProperty` - `(input)` returns the envelope or
  `undefined`.
- `index.ts:readResolvedProperty` - `(input)` returns the value or
  `undefined`.
- `index.ts:writeResolvedProperty` - `(input)` with `value` and optional
  `source`.
- `index.ts:setManualResolvedProperty` - `(input)` with `value`, `source`,
  `force` and `commandId`.
- `index.ts:retireManualResolvedProperty` - `(input)`.
- `index.ts:createResolvedSlugOwnerLookup` - `(rootDir?)` returns
  `(kind, slug) => owner`.

## Invariants

- `ResolvedProperty.ts:schema` - `.strict()` on the envelope, `metadata` and
  `spec`; `apiVersion` must equal `INTAKE_API_VERSION`; `metadata.namespace`
  must be the literal `intake`.
- `ResolvedProperty.ts:specSchema` - at most one entry may omit
  `inputFingerprint` (`Only one entry may omit inputFingerprint.`).
- `ResolvedProperty.ts:parseResolvedProperty` - throws
  `ResolvedProperty is malformed at <path>.`; read and write both parse.
- `ResolvedProperty.ts:readResolvedPropertyEnvelope` - throws on a `ref.kind`
  mismatch, a sha256 mismatch and a namespace mismatch.
- `ResolvedProperty.ts:validateAgencyLocations` - for subject kind `Agency`
  and target property `location_path_id`, every entry value is checked with
  `requireAgencyPlaceLocationPath`.
- `index.ts:readableResolvedPropertyFile` - throws
  `ResolvedProperty path is not a file: <path>`; a missing path returns
  `false`. Not exported; used by `inspectResolvedProperty` and
  `writeResolvedProperty`.
- `index.ts:inspectResolvedProperty` - throws when `metadata.name` or the
  spec's subject and target property differ from the cache name.
- `index.ts:writeResolvedProperty` - throws when the same input fingerprint
  already has a different value. It writes nothing when `rootDir` is
  undefined, and nothing when no fingerprint is given and the entry without a
  fingerprint already holds the same value.
- `index.ts:setManualResolvedProperty` - throws
  `Cache already has a value. Use --force to overwrite.` when an envelope
  exists and `force` is false. A replaced manual entry is kept with the
  fingerprint `previous-override-<n>`.
- `index.ts:retireManualResolvedProperty` - changes nothing unless an entry
  has no fingerprint and has a `commandId`. That entry is kept with the
  fingerprint `previous-override-<n>`.
- `index.ts:createResolvedSlugOwnerLookup` - throws
  `Canonical slug conflict` when one slug belongs to two names of a kind, and
  `Invalid canonical slug cache for <kind> <name>.` when a cached slug is not
  a string or is blank.

## Side Effects

- `index.ts:inspectResolvedProperty` - reads one `ResolvedProperty` file.
- `index.ts:writeResolvedProperty` - reads and writes one `ResolvedProperty`
  file.
- `index.ts:setManualResolvedProperty` - reads and writes one
  `ResolvedProperty` file; stamps the new entry's `recordedAt` from the system
  clock.
- `index.ts:retireManualResolvedProperty` - reads one `ResolvedProperty` file
  and rewrites it when it retires an entry.
- `index.ts:createResolvedSlugOwnerLookup` - lists the `ResolvedProperty`
  directory once and reads the slug envelopes of each kind asked for.

## Verification

- Run: `npx vitest run test/cli/state/resolved-property.test.ts test/cli/state/resolved-slug-owners.test.ts test/cli/state/agency-place-cache.test.ts`
