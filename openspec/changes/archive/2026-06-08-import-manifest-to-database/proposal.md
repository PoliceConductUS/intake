## Why

The intake CLI needs a direct way to load an existing source-produced `ImportPackage` manifest into the database without running a source module. This gives MN POST data a concrete import path now and creates the reusable pipeline that later orchestration commands can call after they generate a manifest.

## What Changes

**Manifest Import Command**

- From: The root CLI only has the initial local manifest validation scaffold.
- To: The root CLI supports `intake import manifest <manifest-ref>` for a local `ImportPackage` manifest.
- Reason: Operators need to import source-produced manifests directly before source-module orchestration exists.
- Impact: New CLI behavior and tests.

**Source-Key Mapping**

- From: Imported source entity IDs are not resolved by the root intake CLI.
- To: Manifest entity IDs are treated as source keys and resolved through `$INTAKE_WORKSPACE/intake/sources/<namespace>/` before database writes.
- Reason: Canonical database IDs are intake-owned and must be durable across resets.
- Impact: Adds a checked-in MN POST mapping file and mapping persistence behavior.

**Database Loading**

- From: There is no direct manifest-to-database loading path.
- To: Supported manifest entities are transformed into `public.agency`, `public.officers`, and `public.agency_officers` rows and written through `DATABASE_URL`.
- Reason: The first MN POST manifest should be importable without expanding seed-based loading.
- Impact: Adds runtime database access and dependency changes as needed.

## Capabilities

### New Capabilities

- `manifest-database-import`: Defines direct `ImportPackage` manifest import, source-key mapping resolution, supported entity transformations, database writes, and fail-fast behavior.

### Modified Capabilities

- None.

## Impact

Affected areas:

- `src/cli.ts` and related import modules for nested `import manifest` command routing.
- New manifest parsing, validation, mapping, transformation, and database writer code.
- `$INTAKE_WORKSPACE/intake/sources/mn-post/` seeded from the current MN POST manifest and current `supabase/seed.sql`.
- `package.json` and `package-lock.json` for `@paralleldrive/cuid2` and any required PostgreSQL/YAML parsing dependencies.
- Tests for CLI behavior, manifest validation, mapping persistence, transformation output, and database write failure handling.
- Supabase validation only if schema or seed interactions change; no schema migration or generated type refresh is expected from the proposal.
