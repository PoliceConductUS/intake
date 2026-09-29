## Context

All ten named tables were rechecked and contain zero rows. The only inbound
foreign keys come from other tables in the same removal set. Existing local
Supabase migration history matches the 33 checked-in migrations.

## Goals / Non-Goals

The goal is one migration removing exactly the authorized tables and applying
it locally. Website changes and production deployment are outside this change.

## Decisions

Use a single explicit `DROP TABLE` statement without `CASCADE` or `IF EXISTS`.
This removes the authorized set together and lets unexpected schema state or
dependencies fail visibly. Preserve the retired seed file.

## Risks / Trade-offs

Existing website consumers will fail until the other agent updates them. Intake
references to the removed tables are removed in this change. Old artifacts for
the three retired record kinds are rejected by the regenerated contracts.

Remove only the retired outputs from multi-output sources. Preserve federal
agencies and office agency records, plus video coverage and personnel links.
Replace agency-link fixtures in graph-selection tests with agency phone-number
fixtures to retain coverage of historical-root selection.

## Migration Plan

Validate the complete migration chain on disposable PostgreSQL and rehearse the
drop in a rolled-back local transaction. Apply through Supabase migration
tracking, then compare table inventories and retained-table row counts.
