# Complete Irving Arrest Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task with TDD and review.

**Goal:** Import complete verified Irving arrest/charge, arrest-beat and residential-income aggregates for later website use.

**Architecture:** Source acquisition preserves private raw evidence; pure stages normalize all booking/charge relationships and aggregate enriched records. Existing officer profiles and a new agency profile are filed through shared intake.

**Tech Stack:** TypeScript, ExcelJS, PostgreSQL/PostGIS, canonical intake IO, Vitest.

**Spec:** specs/irving-arrest-analytics/spec.md

## Global Constraints

Preserve all supplied charge rows. No primary charge. No home beat. No invented geography or income. No source-specific shared pipeline branches. Do not publish private addresses, names, booking IDs or address coordinates. Do not edit Oregon work. Reuse approved worktree; no new worktree. User authorized scoped implementation and data import; no repeat approval gate.

## Task 1: Reconcile original source and geographic evidence

- [x] Audit real workbook joins, source keys, repeated rows and observed missing relationships.
- [x] Verify Census address/tract and ACS cache against original residential addresses; acquire official Irving beat polygons and arrest-address point evidence.
- [x] Save hashes and counts without PII in public audit output.

## Task 2: Complete pure normalized records and aggregation

Files: sources/gov.irvingtx.arrests/arrest.ts, acquire.ts, transform.ts, additional narrowly scoped source modules; test/sources/gov.irvingtx.arrests/\*.test.ts.

- [x] Write failing fixture tests: two booking rows with same Booking_No count once; all three charge rows survive with two equal tuples reported as three source rows/two distinct tuples; no first-charge behavior; geographic/income cells reconcile.
- [x] Implement strict source input/normalized contract, complete charge and offense arrays, counts and evidence provenance. Reject old truncated JSONL shape.
- [x] Preserve every booking in agency totals; matched officer aggregation counts each booking once per officer, with unmatched coverage explicit.
- [x] Run tests and review before importing.

## Task 3: Agency aggregate persistence

Files: additive supabase migration; scripts/lib/entity-spec-generator.ts descriptors and generated outputs; src/cli/import/artifacts/agency-graph.ts metadata; canonical IO/graph tests.

- [x] Test new AgencyArrestProfile persistence schema and shared inclusion using real migration and canonical artifact IO.
- [x] Add agency_arrest_profile table with explicit ID, unique agency_id FK, coverage/breakdowns JSONB, created/updated timestamps. Register descriptor and graph edge; generate canonical IO from schema.
- [x] Verify migration and generated contracts; apply additive migration to configured development database without reset.

## Task 4: Import and verify

- [x] Run acquire, transform, generate, inspect proposed mutations, then up with dev-copy workspace.
- [x] Compare DB agency totals/cells and officer coverage against independently audited original workbook.
- [x] Verify mutation chain and rerun generation to establish no-op.
- [x] Record source coverage, remaining observed gaps, all test evidence and website contract in verify.md. Review entire scoped diff.
