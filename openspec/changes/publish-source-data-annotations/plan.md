# Publish Source Data Annotations Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Preserve reported data and publish final-state annotations beside records, in a central index and under the supplying licensing authority.

**Architecture:** Imports preserve values and provenance. One explicit stage after all mutations succeed scans final records and atomically replaces warnings/errors while preserving mutation-carried correction annotations. Static site views and CSV downloads consume the same persisted findings.

**Tech Stack:** TypeScript, canonical intake IO, PostgreSQL/Supabase, Astro static generation.

**Spec:** `design.md`, `tasks.md`, and the delta specs in this change.

## Global Constraints

- Types are exactly `warning`, `error`, and `correction`; no annotation IDs, table, API or workflow.
- No invented source values, identities, geography, or changed established slugs.
- Keep original unrepresentable values in durable source evidence and expose them; null storage must not assert current employment.
- Replace correction sets only for processed owner/namespace/source-ID contributions; preserve other contributions.
- Recompute warnings/errors after the whole mutation batch, including no-pending-mutations runs; a failed batch does not recalculate.
- Central and authority CSV downloads include all filtered results, not one page.
- Resolve the design's agency-geography/routing question before implementing invalid-address retention. This plan does not authorize choosing a new route scheme.

## Review Focus

- Invalid literal end dates must not become open employment in graph selection or site queries (Tasks 1–3).
- Later mutations can correct temporary invalid values; scan only final state (Task 2).
- Warnings can expire with time even without source updates (Task 2).
- Same person with multiple providers must retain exact value attribution (Tasks 2–3).
- Authority CSV must include all its source record types and pages (Task 4).

## Task 1: Storage and canonical contracts

**Files:** new `supabase/migrations/<timestamp>_source_data_annotations.sql`; `scripts/generate-envelope-types.ts` and its schema inputs; generated `src/shared/io/` and mutation contracts; `test/import/artifacts/source-value-defects.test.ts`.

**Interfaces:** canonical `DataAnnotation` with field/value/type/message/source_namespace/source_record_id plus correction replacement_value and optional evidence; entity `data_annotations` arrays. Canonical mutation payloads also identify correction replacement scopes (owner, namespace, source record ID) with complete sets, including empty sets. Original-value provenance remains available to the final-state scanner.

- [ ] Resolve the identified geography contract decision and update the relevant delta spec; reconcile current `intake-date-validation` omission requirement from the archived predecessor.
- [ ] Write failing contract tests for strict annotation shape, literal original values and representable contradictory date preservation.
- [ ] Add the migration and shared schema through owning generators; do not hand-edit generated contracts. Adjust only the agreed affected column constraints.
- [ ] Run `npm run generate:envelope-types`, `npm run typecheck` and focused contract tests; verify migration/reset/seed in a disposable database, including existing integrity assertions.
- [ ] Commit the scoped contracts with a Conventional Commit.

## Task 2: Value preservation and post-mutation scan

**Files:** `src/shared/source-value-types.ts`, `src/cli/import/artifacts/data-context.ts`, `src/cli/import/artifacts/agency-graph.ts`; the existing data-up orchestration (locate its batch-success boundary); new `src/cli/database/recalculate-data-annotations.ts`; relevant source transform admission gates; `test/import/artifacts/source-value-defects.test.ts`, `test/import/artifacts/agency-graph.test.ts`, new `test/cli/database/recalculate-data-annotations.test.ts`.

**Interfaces:** `recalculateDataAnnotations({ database, sourceEvidence, validationDate })` is an explicit database stage. It inspects final rows with their source evidence and atomically replaces warning/error entries, preserving correction entries already applied with mutations.

- [ ] Write failing tests for the five audited Texas date pairs: preserve assignments/personnel and exact dates. Add scheduled-future and long-duration fixtures and an invalid literal end-date fixture that does not qualify as current employment.
- [ ] Replace factual-defect omission with value/evidence preservation uniformly; retain structural errors and explicit exclusions.
- [ ] Write failing batch tests: intermediate conflict resolved later creates no error; corrected final values clear errors; unchanged input/day produces identical findings; day change clears future warning; failed mutation does not scan; failed scan retains prior warnings/errors and already-applied corrections and fails command; no-pending run retries.
- [ ] Extend the existing applied-correction callback and canonical mutation generation to carry original/replacement values, explanation and supplied evidence. Compare annotation content even when the effective field value is unchanged.
- [ ] Write failing correction replacement tests: A and B providers coexist; A1 and A2 in one namespace coexist; empty A1 clears only A1; unprocessed contributions survive; nonmatching overrides add nothing; all mutations in one run retain the full contribution. Apply replacements against current stored arrays.
- [ ] Implement the scan and invoke it once at the full batch-success boundary, including reset's final mutation completion. Ensure reset does not scan each internal source batch; expose the single orchestration boundary internally without adding a user-facing CLI option.
- [ ] Run `node --import tsx node_modules/vitest/vitest.mjs run test/import/artifacts/source-value-defects.test.ts test/import/artifacts/agency-graph.test.ts test/cli/database/recalculate-data-annotations.test.ts` and `npm run typecheck`.
- [ ] Verify source provenance with two providers contributing values to the same canonical entity; commit the scoped change.

## Task 3: Shared website display and collection

**Files in `../policeconduct.org`:** new `src/components/DataAnnotations.astro`, new `src/lib/data/data-annotations.ts`; existing `src/lib/data/personnel.ts`, `src/lib/data/licensing-authority.js` and affected loaders/displays; `src/pages/personnel/[slug]/index.astro`; new `tests/e2e/data-annotations.spec.ts`.

**Interfaces:** one collected entry includes owner label/public URL plus the stored annotation. Explicit namespace-to-authority mapping determines source ownership. Renderers consume stored findings; they do not independently detect defects.

- [ ] Read sibling AGENTS and OpenSpec contracts before edits; add the corresponding site change artifacts.
- [ ] Write failing fixtures for negative tenure, 125-year tenure, unparseable literal dates, and exact provider attribution, plus a corrected address with a concurrent warning.
- [ ] Add annotation loading and shared rendering beside affected fields; preserve reported dates and source attribution without calculated tenure.
- [ ] Build the shared collector and explicit authority/source mapping, verifying links point to the owning record display.
- [ ] Run focused site fixture tests through the repository's configured e2e runner and generated type checks; commit scoped site changes.

## Task 4: Central and licensing-authority routes and downloads

**Files in `../policeconduct.org`:** new route family `src/pages/data-annotations/`; new `src/pages/[category]/licensing-authority/data-annotations/`; existing `src/pages/[category]/licensing-authority/index.astro`; `src/lib/pagination.ts`; the shared annotation loader and e2e test from Task 3.

**Interfaces:** one deterministic filtered collection drives HTML pagination and CSV. Use existing `PAGE_SIZE = 50`. CSV columns are exactly those in the public spec.

- [ ] Write failing tests for 125 matching entries: 50 visible on first page, all 125 in CSV; provider/type filters persist through pagination.
- [ ] Add static central routes and finite filtered exports using the shared collection.
- [ ] Add linked authority subpages, fixed source ownership, type filtering and complete CSV download; test an authority with no findings and a person with annotations from unrelated sources.
- [ ] Verify CSV quotes/newlines/original values, correction replacement values and supplied evidence round-trip and all entry links lead to affected displays.
- [ ] Run focused site tests and inspect generated profile, central and authority pages; commit the scoped change.

## Task 5: End-to-end verification and release

- [ ] Run `npm run openspec:validate`, focused intake tests and typecheck; verify disposable migration/reset/seed with intact references and IDs.
- [ ] Regenerate affected imports against a disposable database, scan annotations once after final application, and verify the five audited personnel identities and findings.
- [ ] Build a site preview against that dataset and compare profile/index/authority/CSV content and counts.
- [ ] Record actual evidence in verify.md only after execution. Reconcile superseded requirements before archive.
- [ ] Release through normal procedures: forward migration, imports, final scan, site rebuild. No production reset or deployment is performed by this proposal.
