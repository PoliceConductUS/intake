## Design Summary

Add a direct manifest import path to the root intake CLI:

```text
intake import manifest /path/to/manifest.yaml
```

The command accepts a source-produced `ImportPackage` manifest, validates the manifest contract needed by the current database import path, resolves source entity IDs through a per-source YAML mapping file, assigns missing canonical IDs with `@paralleldrive/cuid2`, persists new mappings before database writes, transforms supported entities into current database rows, and writes them to the database named by `DATABASE_URL`.

The first supported source namespace is `mn-post`, with mappings stored at `$INTAKE_WORKSPACE/intake/sources/mn-post/`. The core invariant is:

```text
source entity + mapping record = database row
```

Source-owned values come from the manifest. Intake-owned resolution values come from mapping records. Manifest fields that do not fit the current database schema are ignored unless this change explicitly adds schema support.

## Alternatives Considered

### Approach A: Direct manifest import with durable YAML mappings

- **Approach**: Add `intake import manifest <manifest-ref>` as the manifest pipeline entry point. Load `$INTAKE_WORKSPACE/intake/sources/<namespace>/`, create any missing mapping records using checked-in or persisted source-key mappings, transform supported entities, and insert rows directly through `DATABASE_URL`.
- **Pros**: Gives source-module orchestration a reusable downstream path, keeps source identity separate from canonical identity, supports deterministic reset/replay once mappings are committed, and keeps duplicate resolution out of scope.
- **Cons**: Requires careful write ordering and all validation must complete before any database mutation.
- **Why selected**: It matches the requested command, ADR 0008, and the requirement that later `intake import mn post` orchestration reuse the same manifest import pipeline.

### Approach B: Put canonical IDs in source-produced manifests

- **Approach**: Require the MN POST source module to emit canonical database IDs, slugs, locations, and coordinates directly in its manifest.
- **Pros**: Simplifies the root intake importer.
- **Cons**: Moves intake-owned resolution decisions into source modules, weakens source/canonical identity separation, and makes reuse across sources harder.
- **Why not selected**: The request explicitly says manifest entity IDs are source keys and that mapping records own canonical IDs and resolution data.

### Approach C: Import through seed generation

- **Approach**: Generate SQL seed blocks from the manifest and let existing Supabase reset load those rows.
- **Pros**: Uses existing seed mechanics and avoids runtime database writes.
- **Cons**: Expands seed-based loading, delays import feedback until reset, makes source-produced data look like hand-authored seed data, and does not satisfy the requested `DATABASE_URL` write path.
- **Why not selected**: This repo is moving away from expanding seed loading, and the requested command must write transformed rows directly to the configured database.

## Agreed Approach

Use Approach A. The CLI gets a nested `import manifest` command that treats manifest import as the reusable pipeline. Source module orchestration remains a later layer that produces a manifest and calls this pipeline.

The importer validates all inputs before database writes, including manifest readability and shape, supported `apiVersion` and `kind`, source namespace, mapping readability and shape, required mapping record fields, relationship references, `DATABASE_URL`, and database connectivity. It must not report success after a partial import.

## Key Decisions

- Support `apiVersion: policeconduct.org/intake/v1alpha1` and `kind: ImportPackage` for this change.
- Resolve mappings from `$INTAKE_WORKSPACE/intake/sources/<metadata.namespace>/`; initially support `mn-post`.
- Use object mapping records:
  - `agencies.<sourceAgencyId>` includes `canonicalId`, `slug`, `locationPathId`, `latitude`, and `longitude`.
  - `personnel.<sourcePersonnelId>` includes `canonicalId` and `slug`.
  - `agencyPersonnel.<sourceRosterId>` includes `canonicalId`.
- Assign missing mapping `canonicalId` values with `@paralleldrive/cuid2` before database writes and persist those mappings.
- Preserve the requested initial known MN POST mappings in `$INTAKE_WORKSPACE/intake/sources/mn-post/`; generating that initial file is implementation setup, not a CLI feature.
- Transform only supported entity families:
  - `spec.entities.agencies` writes to `public.agency`.
  - `spec.entities.personnel` writes to `public.officers`.
  - `spec.entities.agencyPersonnel` writes to `public.agency_officers`.
- Rewrite agency-personnel `agency_id` and `officer_id` from source keys to canonical IDs using the same mapping file.
- Do not add duplicate detection, candidate resolution, source module execution, workspace upload, or schema support for manifest fields that do not fit current database columns.

## Open Questions

- None for the proposal. Implementation should inspect the current manifest and database columns to decide the exact minimal field projection, while preserving the specified source-owned versus intake-owned boundary.
