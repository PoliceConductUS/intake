# Drop Empty Tables Implementation Plan

**Goal:** Remove the ten tables listed in the approved request and apply the
migration to local intake PostgreSQL.

**Architecture:** Add one SQL migration under `supabase/migrations/`. Use
PostgreSQL's normal dependency enforcement and Supabase migration tracking.

**Tech Stack:** PostgreSQL 15, Supabase CLI, existing PostGIS test container.

**Spec:** `specs/empty-table-retirement/spec.md`

## Task 1: Create and apply the migration

- [x] Create a migration with `supabase migration new drop_empty_tables`.
      Its single `DROP TABLE` statement names the ten tables from the spec.
- [x] Remove the three entity descriptors from
      `scripts/lib/entity-spec-generator.ts`, their manual choices, graph edges,
      resolver overrides, and output assembly in `gov.us.federal-le` and
      `youtube.policeactivity`. Preserve the sources' remaining outputs.
- [x] Change source tests to require only retained output kinds, and use
      `AgencyPhoneNumber` fixtures for the existing graph-selection tests.
- [x] Apply the entire migration directory to disposable PostGIS using
      `startIntakeDatabase` from `test/cli/database/intake-postgres.ts`; assert
      all ten tables are absent.
- [x] Capture local application table names and row counts. Within a transaction,
      apply the new SQL, assert only those ten tables disappeared, then roll back.
- [x] Run `supabase migration up --db-url
postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable`.
- [x] Compare retained table names and row counts with the captured snapshot;
      confirm the migration is recorded in `supabase_migrations.schema_migrations`.
- [x] Run `npm run openspec:validate` and `git diff --check`.
- [x] Run `npm run generate:envelope-types` against the migrated local database,
      followed by `npm run generate:data-request-doc`, `npm test`,
      `npm run typecheck`, and `npm run build`.

No shared-database reset or legacy seed loading is part of validation: the seed
is retired (`db.seed.sql_paths = []`) and the populated local data must remain.
