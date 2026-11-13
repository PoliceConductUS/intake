# Current Summary Prompts Implementation Plan

> **For agentic workers:** Use Superpowers execution, TDD and verification within the existing worktree.

**Goal:** Reject obsolete summary results before they can enter a reset database.

**Architecture:** Separate prompt text from TypeScript, share its exact content fingerprint across generation and readers, and prepare retained transforms before destructive reset. Keep the existing canonical mutation pipeline.

**Tech Stack:** TypeScript, Node 24, Vitest, PostgreSQL, existing intake CLI.

**Spec:** specs/current-summary-prompts/spec.md

## Global Constraints

- No new dependencies, schema changes, compatibility fallbacks or new branches.
- No direct database writes or ad hoc cache writes.
- Never represent an obsolete analysis as current.

## Review Focus

- A prompt edit with no manually incremented version must invalidate a saved result.
- A stale older acquisition must fail before destructive reset and leave pointers and the mutation chain intact.
- Current results must retain the same five public narratives.
- Cached PDFs and extracted text must remain reusable during regeneration.
- Existing canonical IDs and source replay order must remain unchanged.

## Task 1: Prepare reset inputs before clearing data

Files: src/cli/data/reset.ts; test/cli/data/reset.test.ts.

- [x] Add a failing regression using a retained stale result and an existing mutation chain; assert no schema reset or mutation application and restored pointer.
- [x] Run that test and inspect the expected failure.
- [x] Inventory and transform existing retained automatic inputs before schema reset using the existing command path.
- [x] Update ordering assertions and run the reset/source pipeline tests.

## Task 2: Load and identify the current prompt

Files: sources/mn-post/acquire/order-analysis.ts; document-evidence.ts; collect-documents.ts; new order-prompt.ts and order-analysis-prompt.txt; related source tests.

- [x] Add a failing test that saves a result, changes prompt content without a numeric version change, and rejects stale reuse/import.
- [x] Move the exact current prompt text to its file, fingerprint its bytes, and require that fingerprint in all completed-result metadata.
- [x] Preserve current output validation and regenerate stale results through acquisition.
- [x] Run all Minnesota source tests and the full intake validation command.

## Task 3: Finish the database comparison and deliver

- [x] Verify the exact historical prompt match, convert current acquisition-result metadata, and replace obsolete results with current analyses for identical PDFs; preserve originals and leave state caches untouched.
- [ ] Finish the interrupted source rebuild through canonical intake commands.
- [ ] Refresh website projections and compare all tables/columns and schema with the verified private backup.
- [ ] Review the diff, commit all pending source changes, push and update the existing PR; verify CI for the final head.
