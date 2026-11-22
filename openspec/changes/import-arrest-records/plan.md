# Import Arrest Records Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development
> to implement this plan task-by-task. Do not start until the owner approves this change and answers the open questions in `design.md`.

**Goal:** Store Irving arrests as booking, charge, offense and officer rows, and replace the aggregate tables with views.

**Architecture:** The existing source `gov/irvingtx/arrests` emits new record kinds through the normal envelope and mutation path. SQL views compute every count. Officer identity grows an agency-scoped employee number.

**Tech Stack:** Supabase PostgreSQL migrations, the intake TypeScript CLI, Vitest, SQL tests against a reset database.

Note: this plan was written by hand from `tasks.md`; the Superpowers `writing-plans` decomposition runs again at apply time.

---

## Task 1: Approval (tasks 1.1-1.3)

- [ ] **Step 1:** Record owner answers in `design.md`.
- [ ] **Step 2:** Write the ADR with the next number.

## Task 2: Officer identity (task 2.1)

- [ ] **Step 1:** Write failing SQL tests for the unique index and `agency_personnel_badge`; write the migration; regenerate types.

## Task 3: Arrest tables (tasks 3.1-3.7)

- [ ] **Step 1:** List the workbook headers (names only); write failing SQL tests for the tables and foreign keys; write the migration; regenerate types.
- [ ] **Step 2:** Write failing tests in `test/` with synthetic values for: one row per booking, repeated rows, booking without charges, every source field stored (name, home address, booking number, arrest location), redacted field stored as released, three charges with a repeat, two officers, unmatched name annotation, no officer name annotation.
- [ ] **Step 3:** Change `acquire.ts` to keep every source field; change `transform.ts` to emit the new kinds; make the tests pass.
- [ ] **Step 4:** Add the annotation codes and band records; commit.
- [ ] **Step 5:** Report the expected counts.

## Task 4: Views and removal (tasks 4.1-4.2)

- [ ] **Step 1:** Write SQL tests comparing view measures with the current JSON values; write the view migration.
- [ ] **Step 2:** Drop the old tables and kinds; commit.

## Task 5: Employee and badge number requests (tasks 5.1-5.3)

- [ ] **Step 1:** Owner fills in and approves `docs/requests/irving-pd-employee-roster-2026-11-22-v1.txt`; send it; record the date.
- [ ] **Step 2:** When the roster arrives, write failing tests for the roster source (numbers, badge history, duplicates, unmatched names); implement; commit.
- [ ] **Step 3:** Draft and send the same request to other agencies whose arrest data uses internal numbers.

## Task 6: Richer CSV (tasks 6.1-6.2)

- [ ] **Step 1:** Inspect headers privately; record names only.
- [ ] **Step 2:** Stop and report if there is no `Booking_No`.

## Task 7: Validation (tasks 7.1-7.4)

- [ ] **Step 1:** `npx openspec validate import-arrest-records`.
- [ ] **Step 2:** Confirm no other worktree is mid-verification; `npm run supabase:reset`; `npm run cli -- data reset --no-acquire`.
- [ ] **Step 3:** Run the integrity assertions; `npm run validate`; commit; `git town sync`.
