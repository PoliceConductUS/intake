# Normalize Seed Display Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize shouting-case seed display names so downstream pages render agency/officer information as reader-facing text.

**Architecture:** Keep normalization in the checked-in seed source instead of runtime display code. Add a Vitest regression test that parses targeted seed insert blocks and rejects all-caps phrase values in display fields.

**Tech Stack:** PostgreSQL seed SQL, TypeScript, Vitest, OpenSpec.

---

### Task 1: Add Failing Seed Display Test

**Files:**

- Create: `test/seed-display.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/seed-display.test.ts` with a small parser for `INSERT INTO public.agency` and `INSERT INTO public.federal_agency` statements. The test should collect `name` column values and fail when a value has at least two uppercase words and no lowercase letters.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/seed-display.test.ts`

Expected: FAIL with examples such as `MELVINDALE POLICE DEPARTMENT` or `IRVING POLICE DEPARTMENT`.

### Task 2: Normalize Seed Data

**Files:**

- Modify: `supabase/seed.sql`

- [ ] **Step 1: Normalize display fields**

Update `public.agency.name` and `public.federal_agency.name` string literals from all-caps phrase casing to title case. Preserve acronyms in parentheses, state codes, IDs, slugs, URLs, source titles, and other source-provided quoted text.

- [ ] **Step 2: Normalize authored notes**

For project-authored notes that say `Agency:` or `Agencies:` followed by the old all-caps display names, update those references to match the normalized display casing.

- [ ] **Step 3: Run focused test to verify it passes**

Run: `npm test -- test/seed-display.test.ts`

Expected: PASS.

### Task 3: Validate Change

**Files:**

- Modify as needed: `openspec/changes/normalize-seed-display-names/tasks.md`

- [ ] **Step 1: Run unit tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run OpenSpec validation**

Run: `npm run openspec:validate`

Expected: OpenSpec validates all specs and the new change.

- [ ] **Step 3: Run Supabase validation if available**

Run: `npm run supabase:reset`

Expected: migrations and seed load complete. If Docker/Supabase is unavailable in the local environment, record that limitation in the final result.
