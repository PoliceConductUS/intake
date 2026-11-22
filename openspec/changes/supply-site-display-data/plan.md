# Supply Site Display Data Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development
> to implement this plan task-by-task. Do not start until the owner approves this change and answers the open questions in `design.md`.

**Goal:** Intake fills every fact the site shows, and the database defines every page-selection rule, foreign-key chain, public count and build projection.

**Architecture:** Facts are columns written through envelopes and recorded mutations. Manual lookups are manual records. Rules, counts and projections are SQL views and materialized views in migrations, refreshed by `public.refresh_site_projections()`.

**Tech Stack:** Supabase PostgreSQL migrations, the intake TypeScript CLI, Vitest, SQL tests run against a reset database.

Note: this plan was written by hand from `tasks.md`; the Superpowers `writing-plans` decomposition runs again at apply time, when exact file paths are known.

---

## Task 1: Approval (tasks 1.1-1.2)

- [ ] **Step 1:** Record owner answers in `design.md`; adjust specs where an answer changes a rule.
- [ ] **Step 2:** Write the ADR in `docs/adr/` with the next number, status Proposed.

## Task 2: Fact columns (tasks 2.1-2.9)

- [ ] **Step 1:** Write a failing SQL test that each new column and check exists.
- [ ] **Step 2:** Write the migration in `supabase/migrations/` with a new timestamp; no data rows.
- [ ] **Step 3:** Run `npm run generate:envelope-types`; commit generated files.
- [ ] **Step 4:** Produce the employment status preview (task 2.2) from transform outputs, without writing to the database; send it to the owner.
- [ ] **Step 5:** For each source, write a failing test per spec scenario, implement the resolved property, make the test pass.
- [ ] **Step 6:** Add manual records through `npm run cli -- data acquire org/policeconduct/manual` with the non-interactive path.
- [ ] **Step 7:** Commit per source.

## Task 3: License action types (tasks 3.1-3.4)

- [ ] **Step 1:** Write a script under `scripts/` that reads transform outputs and prints distinct action texts with counts and producers.
- [ ] **Step 2:** Draft the type set; stop for owner review.
- [ ] **Step 3:** Write a failing test: unknown text fails generation naming the text and record.
- [ ] **Step 4:** Write the migration and the resolver; add kinds to `sources/org/policeconduct/manual/kinds.ts`.
- [ ] **Step 5:** Add the reviewed records; commit.

## Task 4: Annotation message codes (tasks 4.1-4.3)

- [ ] **Step 1:** Check the state of `type-annotation-envelopes`; take the matching branch of task 4.1.
- [ ] **Step 2:** Write failing tests for the code on each producer and for an unknown code.
- [ ] **Step 3:** Implement; add messages; commit.

## Task 5: Text standardization (tasks 5.1-5.3)

- [ ] **Step 1:** Write failing canonical-IO tests for `StandardValue`.
- [ ] **Step 2:** Implement the IO through the generator, not by hand.
- [ ] **Step 3:** Write failing pipeline tests: replacement, correction annotation, repeat generation is a no-op, unknown enumerated value fails.
- [ ] **Step 4:** Implement the shared stage; commit.
- [ ] **Step 5:** Run the proposal script; review; add records; commit.

## Task 6: Selection and count views (tasks 6.1-6.4)

- [ ] **Step 1:** Record the website rule and count inventory in `design.md`.
- [ ] **Step 2:** Write failing SQL tests per scenario in the selection and count specs.
- [ ] **Step 3:** Write the view migration; make the tests pass.
- [ ] **Step 4:** Run the comparison against current website counts; report differences; commit.

## Task 7: Build projections (tasks 7.1-7.3)

- [ ] **Step 1:** Write failing SQL tests: write rejected, duplicate path fails the refresh, missing agency fails, place without centroid has no map point.
- [ ] **Step 2:** Write the migration and the function; make the tests pass.
- [ ] **Step 3:** Compare payloads with the script's output; report differences; commit.

## Task 8: Validation (tasks 8.1-8.4)

- [ ] **Step 1:** Run `npx openspec validate supply-site-display-data`.
- [ ] **Step 2:** Confirm no other worktree is mid-verification; run `npm run supabase:reset` and `npm run cli -- data reset --no-acquire`.
- [ ] **Step 3:** Run the integrity assertions in task 8.3.
- [ ] **Step 4:** Run `npm run validate`; commit; run `git town sync`.
