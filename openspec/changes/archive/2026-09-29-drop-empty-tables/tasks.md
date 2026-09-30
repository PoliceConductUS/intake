## 1. Migration

- [x] 1.1 Add one migration dropping the ten named tables.
- [x] 1.4 Remove the three retired intake models, outputs, and supporting code.
- [x] 1.5 Regenerate contracts and the request document; update affected tests.
- [x] 1.2 Validate the full migration chain on disposable PostgreSQL.
- [x] 1.3 Rehearse against the local database in a rolled-back transaction.

## 2. Application and verification

- [x] 2.1 Apply the migration locally with Supabase migration tracking.
- [x] 2.2 Verify the ten tables are absent and retained-table counts are unchanged.
- [x] 2.3 Run OpenSpec validation and record the results.
- [x] 2.4 Run intake tests, type checking, and build.
