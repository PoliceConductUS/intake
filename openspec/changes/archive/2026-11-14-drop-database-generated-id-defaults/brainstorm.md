## Design Summary

Seven `id` columns in the migrated schema still carry
`default public.generate_cuid()`: `agency`, `agency_personnel`,
`agency_phone_numbers`, `personnel`, `review_links`, `review_personnel`, and
`reviews`. AGENTS.md and ADR 0008 say the database never generates an ID for a
durable record. A new migration drops those seven defaults, so an insert that
omits `id` fails on the existing `not null` constraint instead of silently
minting an unstable ID.

The user approved this scope directly on 2026-11-12; no question-and-answer
session was held.

## Alternatives Considered

### A: Drop the seven defaults (chosen)

- **Approach**: one migration with seven `alter column id drop default`
  statements.
- **Pros**: smallest change; metadata-only; the schema now enforces the rule.
- **Cons**: `public.generate_cuid()` stays in the schema, unused.

### B: Drop the defaults and the `generate_cuid()` function

- **Approach**: A, plus `drop function public.generate_cuid()`.
- **Pros**: removes the generator entirely.
- **Cons**: wider than the approved scope; callers outside this repo and the
  legacy `seed.sql` record were not checked.
- **Why not**: not approved, and its outside callers are unverified.

### C: Keep the defaults and rely on the architecture test

- **Approach**: leave the schema; `test/architecture.test.ts` already blocks
  new ID-generating migrations.
- **Pros**: no migration.
- **Cons**: the database can still mint an ID for seven tables.
- **Why not**: it leaves the rule unenforced where it matters.

## Agreed Approach

Alternative A. It is the scope the user approved and the smallest change that
makes the schema enforce the stable-ID rule.

## Key Decisions

- Drop defaults only; keep `public.generate_cuid()` (implementer's call, per
  alternative B's unverified callers).
- Prove the outcome with a schema test that fails on any value-generating
  default or identity column in `public`, not only these seven.
- Applied migrations are not edited; the change is a new migration.

## Open Questions

None.
