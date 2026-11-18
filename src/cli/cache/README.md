# cache

## Overview

Registers the `cache` command group, which inspects or corrects a record
property by source identity:

- `cache alias <namespace> <kind> <new-source-id> <existing-source-id>` with
  required `--evidence <reference>` - maps a new source name to an existing
  canonical ID.
- `cache get <namespace> <kind> <source-id> <property>` - prints the property
  correction or the resolved property.
- `cache set <namespace> <kind> <source-id> <property> <value>` and
  `cache unset <namespace> <kind> <source-id> <property>` - both take
  required `--message <message>` and optional `--from <existing-value>` and
  `--force`. They write a property correction. When the source name has a
  canonical ID in the `SourceNameToCanonicalId` ledger, they also retire the
  manual resolved property.

## Interface

- `index.ts:registerCliCommand` - `(program, dependencies)`; the only export.
  It registers `cache` with `alias`, `get`, `set` and `unset`.

## Invariants

- `index.ts:registerCliCommand` - no action throws. Every error below is
  caught and returned as exit code 1 with the message on stderr.
- `index.ts:registerCliCommand` - for `alias`, the namespace, both source IDs
  and `--evidence` must be non-empty, and `kind` must be in
  `RECORD_KINDS_IN_DEPENDENCY_ORDER`.
- `index.ts:registerCliCommand` - `alias` fails with:
  - `Existing source mapping is missing: <namespace>/<kind>/<existing-source-id>.`
    when the existing source name has no canonical ID.
  - `Source <namespace>/<kind>/<new-source-id> already maps to <id>, not <canonicalId>.`
    when the new source name already maps to a different canonical ID.
  - `Reverse source mapping is missing: <namespace>/<kind>/<canonicalId>.`
    when the new source name already maps to the canonical ID and the ledger
    has no source name for that ID.
  - `Alias resolved to conflicting canonical ID <id>.` when
    `ledger.findOrCreate` returns a different canonical ID.
- `index.ts:registerCliCommand` - for `set` and `unset`, `--message` must be
  at least 10 characters.
- `index.ts:registerCliCommand` - `get`, `set` and `unset` call
  `correctionPropertySchema(kind, property)` first.
- `index.ts:registerCliCommand` - `set` and `unset` fail with
  `Cache already has a value. Use --force to overwrite.` when a resolved
  property exists and `--force` is absent. The check runs only when the
  source name has a canonical ID in the ledger.
- `index.ts:registerCliCommand` - `get`, `set` and `unset` fail with
  `No cached value for <namespace>/<kind>/<source-id>.<property>.` when there
  is nothing to print.
- `index.ts:registerCliCommand` - `getLocationPathById` (not exported) fails
  with `DATABASE_URL is required to verify an agency location is a place.`
  when it is called without `DATABASE_URL`.
- `index.ts:parseValue` (not exported) - a value that fails the property's
  schema throws.

## Side Effects

- `index.ts:registerCliCommand` - reads the workspace from `process.env`
  through `intakeWorkspace` (`INTAKE_WORKSPACE`), and reads `DATABASE_URL`.
- `index.ts:registerCliCommand` - `alias` reads and writes the
  `SourceNameToCanonicalId` ledger (`ledger.read`, `ledger.readSourceName`,
  `ledger.findOrCreate`), creates a command directory, and writes a
  `SourceNameToCanonicalId` envelope into it.
- `index.ts:registerCliCommand` - `set` and `unset` create a command
  directory and call `setPropertyCorrection`. They call
  `retireManualResolvedProperty` only when the source name has a canonical ID
  in the ledger.
- `index.ts:registerCliCommand` - `get` reads through
  `inspectPropertyCorrection` and `inspectResolvedProperty`.
- `index.ts:registerCliCommand` - connects to the database only when a
  `location_path` must be read with `readLocationPathById`.

## Verification

- Run: `npx vitest run test/cli/cache.test.ts test/cli/cache-alias.test.ts test/cli/property-corrections.test.ts`
