## Context

Existing IDs are checked for existence without consistently checking location level.

## Decisions

Validate the referenced location row before accepting or returning an agency location ID. Reject non-place values visibly before caching or assigning them. Retain existing missing-ID failures.

## Scope

Work in `.worktrees/redesign-config-driven-intake`. Scope includes resolver and cache enforcement, tests, and the requested database migration.

## Database enforcement

Add a unique key on location-path ID and level. Agency receives a generated constant `location_path_level = 'place'` and a composite foreign key referencing `(location_path_id, level)`. PostgreSQL validates existing rows and enforces agency inserts, updates, and referenced-place reclassification. The generated column cannot be overridden. This restores the original approach at the user's request.

## Local data

The user will run `npm run cli -- data reset --no-acquire` in this worktree. Do not seed from `seed.sql` or make direct database changes. Envelope types and data requests are regenerated against the migrated schema in a disposable test database. Do not assign a guessed place.

## Generated contracts and requests

Schema introspection excludes database-generated columns from writable entity fields and foreign-key metadata. Generated agency record, create, and update contracts and provider data requests therefore omit `location_path_level`. Unique constraints containing the primary key support database enforcement and are excluded from natural business keys.
