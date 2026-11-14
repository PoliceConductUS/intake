# Omit Intake Fields From The Data Request Implementation Plan

**Goal:** The public data-request document asks only for what a provider can supply and always matches its generator.

**Architecture:** The generator's existing omission sets gain two columns and two record kinds. An integration test regenerates every generated file from a disposable migrated database and compares it with the committed copy.

**Tech Stack:** TypeScript generator scripts, vitest, testcontainers, prettier.

---

## Task 1: Generator

- [x] **Step 1:** In `test/data-request-doc.test.ts`, add a case with the Institute-controlled columns and assert none appears; add `agency_arrest_profile`, `data_annotation`, and `personnel_photo` tables and assert no section for any. Run it; expect failure.
- [x] **Step 2:** In `scripts/lib/data-request-doc-generator.ts`, add an `INSTITUTE_CONTROLLED` set for the columns and add the three kinds to `OMITTED_KINDS`. Run the test; expect pass.

## Task 2: Document

- [x] **Step 1:** Run `scripts/generate-data-request-doc.ts` with `DATABASE_URL` pointing at a disposable database built from the migrations, then format the output.
- [x] **Step 2:** Add `test/generated-files.integration.test.ts`; expect pass.

## Task 3: Validation

- [x] **Step 1:** Run `npm run validate`; expect exit 0 with no skipped tests.
- [x] **Step 2:** Commit.
