## Context

The initial schema gave many `id` columns `default public.generate_cuid()`.
Later migrations removed most of them. Seven remain: `agency`,
`agency_personnel`, `agency_phone_numbers`, `personnel`, `review_links`,
`review_personnel`, and `reviews`. Intake resolves every canonical ID through
the source-name mapping before it writes a row (ADR 0008), so nothing in the
write path uses these defaults.

## Goals / Non-Goals

**Goals:**

- No column in `public` can generate a value for a durable record's ID.
- A writer that omits an ID fails loudly.
- A test keeps a future migration from reintroducing a generated ID.

**Non-Goals:**

- Dropping `public.generate_cuid()`.
- Editing applied migrations.
- Changing how intake assigns IDs.

## Decisions

- **One new migration with seven `drop default` statements.** Applied
  migrations are history; a new migration is the only way to change the
  schema.
- **Schema test over a per-table list.** The test queries
  `information_schema.columns` for any `generate_cuid`, `gen_random_uuid`,
  `uuid_generate`, or `nextval` default and any identity column, and expects
  none. It needs no update when tables are added.
- **Keep the function.** Its callers outside this repo are unverified.

## Risks / Trade-offs

- [A writer outside intake inserts without an ID] → it now fails with a
  `not null` violation, which is the intended behavior; a search of
  `policeconduct.org` found no such insert.
- [A test fixture inserts without an ID] → the full test suite runs against
  the migrated schema and exposes it.

## Migration Plan

Apply the migration with the normal migration run. It is metadata-only and
needs no data reset. Rollback is a migration that restores the seven defaults.

## Open Questions

None.
