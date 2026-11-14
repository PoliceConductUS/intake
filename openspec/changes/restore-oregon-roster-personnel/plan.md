# Oregon Roster Inclusion Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development task by task. The user already approved the outcome and continuation; no second scope approval is needed.

**Goal:** Restore roster people without a certificate gate and preserve public IDs and URLs.

**Architecture:** Remove the Oregon certificate condition and use the existing shared CLI/state/mutation pipeline. The mistaken local manual correction has been removed; its temporary cleanup operation is withdrawn from the delivered change.

**Tech Stack:** TypeScript, Vitest, existing canonical IO, PostgreSQL.

**Spec:** specs/oregon-dpsst/spec.md

## Global Constraints

- Certificates are optional for Oregon roster inclusion.
- Preserve canonical IDs and stored slugs; no new IDs for returning records.
- No raw-input edits, direct SQL writes, fabricated fields, boolean publication flags or published-person exceptions.
- Preserve existing required-data validation and unrelated source/exclusion behavior.
- Reuse the current worktree/branch and preserve existing changes.

## Review Focus

Empty certificates, medical-only certificates and malformed certificates need different observable results. Local correction cleanup is complete and ships no new interface. Source behavior is covered by Task 1.

### Task 1: Remove the Oregon certificate condition

**Files:** sources/gov.or.dpsst/transform.ts; test/oregon-transform.test.ts; sources/gov.or.dpsst/README.md.

**Interfaces:** Existing SourceTransform input/output and source-local record keys remain unchanged.

- [x] Change the current omission regressions to require real Personnel, AgencyPersonnel and Agency records for empty/medical/instructor certificates; require zero invented licenses for empty data.
- [x] Run those tests and observe failure on the current certificate gate.
- [x] Remove only the certificate gate and its unused set; update the source scope documentation. Retain credential parsing and normal agency/relationship handling.
- [x] Run the source suite and typecheck; report exact results. Parent performs the integrated commit after task review and final validation.

### Task 2: Complete local cleanup and withdraw the temporary interface

The mistakenly created operator-local correction was removed through a tested temporary CLI operation. The cleanup did not change source data or database rows and is not the roster restoration fix.

- [x] Complete local correction cleanup without database changes.
- [x] Withdraw the temporary operation from README.md, src/cli/cache/index.ts, src/shared/io/property-corrections.ts and test/cli/cache.test.ts; restore those files to HEAD.
- [x] Remove the temporary property-corrections specification delta and describe cleanup as completed local work.
- [x] Run covering cache/source tests, typecheck and relevant formatting checks on the narrowed change; parent performs full integration validation.

### Task 3: Restore data and finish release

- [x] Confirm the local diagnosis correction has been removed. Do not use manual corrections/inclusion as the roster fix; respect existing explicit exclusions and surface any remaining conflict with public URL preservation.
- [ ] Transform and generate Oregon mutations; review changes and apply through data up. Check all previously public IDs/slugs and every existing public URL without retiring any.
- [ ] Complete full intake validation, independent review, archive, commit/push and CI on the final head.
- [ ] Complete full website validation, build, sitemap/redirect/copy checks, and the already-authorized production release. Record actual deployed results.
