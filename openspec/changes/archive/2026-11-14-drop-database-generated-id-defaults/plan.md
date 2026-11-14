# Drop Database-Generated ID Defaults Implementation Plan

**Goal:** No column in the migrated `public` schema can generate an ID.

**Architecture:** One new plain-Postgres migration drops seven column
defaults. One integration test inspects the migrated schema in a disposable
Postgres container and proves an insert without an ID fails.

**Tech Stack:** PostgreSQL migrations, vitest, testcontainers.

---

## Task 1: Schema test

- [x] **Step 1:** Create `test/cli/database/id-defaults.integration.test.ts` using `startIntakeDatabase`.
- [x] **Step 2:** Query `information_schema.columns` in `public` for defaults matching `generate_cuid|gen_random_uuid|uuid_generate|nextval` or `is_identity = 'YES'`; expect `[]`.
- [x] **Step 3:** Run `npx vitest run test/cli/database/id-defaults.integration.test.ts`; expect failure listing the seven `id` columns.
- [x] **Step 4:** Add a case that inserts into each of the seven tables with `default values` and expects SQLSTATE `23502` on column `id`.

## Task 2: Migration

- [x] **Step 1:** Create `supabase/migrations/20261112000000_drop_generated_id_defaults.sql` with one `alter table public.<table> alter column id drop default;` per table.
- [x] **Step 2:** Re-run the test from Task 1; expect pass.
- [x] **Step 3:** Run `npm run generate:envelope-types` with `DATABASE_URL` pointing at a disposable database built from the migrations; expect only the migration list and fingerprint in `src/shared/io/generated/entity-specs.ts` to change.

## Task 3: Validation

- [x] **Step 1:** Run `npm run validate`; expect exit 0 with no skipped tests.
- [x] **Step 2:** Commit with `feat(schema): drop database-generated id defaults`.
