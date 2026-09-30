## Design Summary

Drop the ten application tables verified empty in the local intake database.
The user explicitly requested creating and applying the migration and assigned
website changes to another agent.

## Alternatives Considered

- Keep the empty tables: preserves existing consumers but does not implement the
  requested removal.
- Drop the explicit set in one migration: implements the requested scope and
  lets PostgreSQL reject dependencies outside that set.

## Agreed Approach

Use one explicit `DROP TABLE` statement without `CASCADE`, verify it against the
current schema, and apply it through Supabase migration tracking locally.

## Key Decisions

- Work in the existing `redesign-config-driven-intake` worktree.
- Preserve all other tables and the retired seed file as historical evidence.
- Do not reset the populated local database or modify the website.

## Open Questions

None. The user also authorized removing the corresponding intake models and
producer code after being told those references still exist.
