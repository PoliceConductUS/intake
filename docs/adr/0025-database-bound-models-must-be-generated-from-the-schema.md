# ADR 0025: Database-Bound Models Must Be Generated From the Schema

## Status

Proposed

> Extends the generator that already produces envelope/entity specs by
> introspecting the database, and forbids hand-written alternatives for anything
> that persists.

## Context

The import generates entity specs (Zod schemas, row/create/update shapes, column
lists, resolved-property lists, FK metadata) by **introspecting the live database
schema** (`scripts/generate-envelope-types.ts` → `src/shared/io/generated/`). A
generated model cannot drift from the table it targets, because the table is its
source of truth.

Yet the codebase also carries **hand-coded** models that mirror tables — e.g.
`AgencyRow`, `AgencyOfficerRow`, `LocationPathRow`, and per-facade `*RowShape`
types. Each is a second, independent description of a table's columns and types.
The moment the schema changes, every hand-coded copy is silently wrong until
someone notices; they are exactly the drift the generator exists to eliminate.

## Decision

**Any model for data that will be written to (or read from) the database MUST be
a model generated from the database schema.** Hand-coding a type that mirrors a
table — its columns, their types, or which are required — is not allowed.

- Row shapes, create/update specs, column lists, resolved-property lists, and FK
  metadata for a persisted entity come from the generator only.
- Facades and resolvers consume the generated models; they do not declare their
  own `*Row`/`*RowShape` copies.
- Adding a new persisted field or entity means changing the schema and
  regenerating — never adding a hand-written type beside the generated one.
- Non-persisted, purely in-memory/transport shapes (a request DTO, a CLI option
  bag) may still be hand-written; the rule binds only to models that reach the
  database.

## Consequences

- One source of truth per table: the schema. A column change surfaces at compile
  time across every consumer of the generated model, instead of drifting.
- Existing hand-coded row/shape types for persisted entities are replaced by the
  generated models (a migration; `AgencyRow` et al. are already gone with the
  transform-row path).
- Reviews reject any new hand-written type that duplicates table columns; the fix
  is to generate it.

## Alternatives Considered

- **Allow hand-coded row types for convenience:** rejected — it reintroduces the
  drift the generator was built to remove, and makes the schema no longer the
  single source of truth.

## Revisit Trigger

Revisit if the generator cannot express a shape a persisted entity genuinely
needs (extend the generator rather than hand-code around it), or if a type is
proven never to touch the database.
