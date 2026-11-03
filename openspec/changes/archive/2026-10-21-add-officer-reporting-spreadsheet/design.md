# Technical design

Recorded on 2026-10-21 from the existing implementation and verification evidence.

## Context

The spreadsheet contains names and article links but no employing-agency column.
Articles supply reviewed identity evidence for existing database records.

## Goals / Non-Goals

Preserve all linked evidence and associate supported reporting with existing
agency-personnel records. Creating personnel, inferring unsupported employers,
and turning source allegation labels into findings are outside this change.

## Decisions

- spreadsheet.ts preserves row references and embedded hyperlink targets.
- acquire.ts saves workbook bytes, article bodies, retrieval outcomes, and hashes.
- reviewed.json binds officer/employer identities and passages to article hashes;
  review-notes.json preserves discrepancies and unresolved evidence.
- transform.ts verifies hashes and passages, uses shared agency/personnel
  resolvers, checks state, and emits the two existing coverage artifact kinds.
- mapping-report.json retains unavailable and unresolved outcomes.

These decisions implement both requirements in
specs/officer-reporting-spreadsheet/spec.md.

## Risks / Trade-offs

Unavailable articles and incomplete rosters limit mapping coverage; those
outcomes remain explicit. Changed article bodies require renewed evidence review.

## Migration Plan

The two migration files restore SQL already applied to the development database.
Historical comparison and rollback-only DDL checks are documented in
verification.md. This closeout does not reset, reload, or mutate the database.

## Open Questions

No remaining implementation decisions are recorded in tasks.md.
