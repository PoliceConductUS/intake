## 1. Schema test

- [x] 1.1 Add `test/cli/database/id-defaults.integration.test.ts` asserting no value-generating default or identity column exists in `public`; confirm it fails listing the seven columns
- [x] 1.2 Add a case asserting an insert without `id` fails with a `not null` violation

## 2. Migration

- [x] 2.1 Add `supabase/migrations/20261112000000_drop_generated_id_defaults.sql` dropping the seven defaults
- [x] 2.2 Confirm the schema test passes
- [x] 2.3 Regenerate envelope specs against the migrated schema with `npm run generate:envelope-types`

## 3. Validation

- [x] 3.1 Run `npm run validate` and fix any fixture that relied on a generated ID
