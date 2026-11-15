# Manual Coverage Links Implementation Plan

**Goal:** Accept manually supplied coverage articles and existing agency-personnel references.

**Architecture:** Existing model-driven acquire/transform flow; only supported-kind configuration changes.

**Tech Stack:** TypeScript, shared Zod schemas, Vitest.

## Task 1

1. Add a regression to test/sources/org.policeconduct.manual/manual.test.ts acquiring CoverageLink and CoverageLinkAgencyPersonnel into temporary state and asserting unchanged emitted records and no personnel artifacts.
2. Run npx vitest run test/sources/org.policeconduct.manual/manual.test.ts and confirm unsupported-kind failure.
3. Add the two kinds in sources/org.policeconduct.manual/kinds.ts.
4. Run focused tests, npm run typecheck and npm run openspec:validate.
5. Record verification and return to the parent agent for review. Preserve the active checkout; do not commit, publish or mutate actual workspace/database state.
