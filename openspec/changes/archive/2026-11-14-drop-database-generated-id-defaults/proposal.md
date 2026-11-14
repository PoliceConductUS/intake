## Why

Seven `id` columns still default to `public.generate_cuid()`, so the database
can mint an ID for a durable record. That contradicts the stable-ID rule
(ADR 0008): an ID minted at insert time changes on every rebuild and breaks
published URLs and cross-record references. Intake always supplies the ID, so
the defaults only hide a writer that forgot one. Removing them turns that
mistake into a loud `not null` failure.

## What Changes

**ID column defaults**

- From: `agency.id`, `agency_personnel.id`, `agency_phone_numbers.id`,
  `personnel.id`, `review_links.id`, `review_personnel.id`, and `reviews.id`
  default to `public.generate_cuid()`.
- To: those columns have no default.
- Reason: the database must never generate an ID for a durable record.
- Impact: **BREAKING** for any writer that inserts into these tables without
  an `id`; it now fails with a `not null` violation. Intake's write path
  already supplies every ID.

A new schema test fails when any `public` column has a value-generating
default or is an identity column.

## Capabilities

### New Capabilities

- `database-id-defaults`: the migrated schema defines no value-generating
  default for any column, so every durable record's ID is supplied by the
  writer.

### Modified Capabilities

None.

## Impact

- Migration: `supabase/migrations/20261112000000_drop_generated_id_defaults.sql`.
- Intake sources: none; the canonical write path supplies explicit IDs.
- Downstream app contracts: `policeconduct.org` reads these tables and does
  not insert into them (checked by search on 2026-11-12).
- No data reset: `drop default` is metadata-only and changes no rows.
- Generated type refresh: required. `npm run generate:envelope-types` updates
  only the migration list and schema fingerprint in
  `src/shared/io/generated/entity-specs.ts`; no generated model changes.
- Production: the change takes effect the next time migrations are applied.
- `public.generate_cuid()` remains defined and unused.
