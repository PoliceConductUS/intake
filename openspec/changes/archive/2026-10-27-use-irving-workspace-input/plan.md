# Use Irving Workspace Input Implementation Plan

> **For agentic workers:** Apply the focused test-first change in the current isolated worktree.

**Goal:** Make Irving acquisition read the workbook from its fixed workspace path without an Irving-specific environment variable.

**Architecture:** Keep the workbook as source input under the source workspace. The acquire adapter resolves it from the existing generic workspace root and writes normalized records into the existing command artifact flow.

**Tech Stack:** TypeScript, Vitest, OpenSpec.

---

## Task 1: Update Irving workbook input

- [x] **Step 1:** Add a test fixture under a temporary `gov.irvingtx.arrests/source/arrests.xlsx` path and verify successful normalization.
- [x] **Step 2:** Run the focused test and confirm it fails because the acquire implementation still requires `IRVING_ARRESTS_FILE`.
- [x] **Step 3:** Resolve the fixed path using `INTAKE_WORKSPACE` and remove the source-specific variable.
- [x] **Step 4:** Run the focused test, typecheck, and OpenSpec validation.
