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

### Task 2: Use acquired source values

- [x] Retain original acquisitions and obtain changed source values through normal intake acquisition.
- [x] Apply the approved conditional exclusion rule without a manual replacement name.
- [x] Preserve canonical IDs and stored slugs through recorded mutations.

### Task 3: Restore data and validate implementation

- [x] Confirm the local diagnosis correction has been removed. Do not use manual corrections/inclusion as the roster fix; respect existing explicit exclusions and surface any remaining conflict with public URL preservation.
- [x] Transform and generate Oregon mutations; review changes and apply through data up. Check all previously public personnel IDs/slugs and route identities without retiring any.
- [x] Complete full intake validation and independent review. Verify and archive after the implementation commit; final CI and release gates remain required.

After merge, complete the website build, sitemap/redirect/copy checks and already-authorized production release. These remain release gates and are tracked separately from implementation completion.

### Task 4: Make temporary exclusions depend on their source values

The user explicitly approved temporary exclusions applying only to the source data that caused them. The agreed small implementation stores the bad original source values as conditions and lets normal source validation process changed records. No name replacement is supplied manually.

## Requirements

- Add optional `when` to the existing workspace ExcludedRecord: a nonempty JSON object mapping source spec field names to exact typed values. No condition means the existing unconditional exclusion behavior. Do not infer lifetime or conditions from reason prose.
- Evaluate every supplied condition field against the unexcluded manifest record spec using own-field presence and exact deep equality. A conditional rule is active only if all fields match. When a source value changes, the old exclusion does not apply; the original source record and normal required-data validation remain effective. Null and missing must be distinct.
- The same active exclusion set must feed exclusion evidence, FK cascade filtering and active-exclusion logging. `when` is workspace metadata: do not widen the existing strict public SourceExclusions shape or publish the condition. A no-longer-active rule must not remain in generated exclusion evidence.
- Extend the existing data exclude operation with `--when <json>` and an explicit `--replace` option for updating an already-existing rule. Normal duplicate rejection remains without replacement. Replacement requires an existing exact kind/source key and preserves every other entry. Reject malformed/empty/array conditions visibly. The existing required reason remains. Do not add another command, a permanent mode, record inclusion, automatic prose migration or a format compatibility layer.
- The durable repair is this shared code behavior. Parent will bind the already-approved temporary entry to the originally observed bad source value through the validated existing operation, then transform fresh acquired source. Do not operate on real state yourself.
- No source namespace, entity kind or source ID branches. No hard-coded person/source identity, fabricated source name, raw-input edit, database schema change/direct write, missing-data fallback or validation weakening. Canonical IO and existing source/canonical identity mechanisms remain authoritative. No new dependencies.

## Files / interfaces

Inspect existing shared exclusion IO, data exclude CLI, shared transform exclusion selection/evidence/filtering and their tests. Prefer a single shared pure active-rule selector. Trace any import exclusion consumers and preserve one meaning. Extend current README exclusion instructions only if needed. Update the current OpenSpec source-exclusions delta; do not create a new branch/worktree.

## Required evidence

Write tests first and observe failures for the new behavior. Cover: original bad source value excludes person and dependent relationships; changed value retains both for normal validation; another unconditional administrative exclusion stays excluded; null versus absent; multiple conditions; invalid condition shapes; duplicate/missing replacement; other workspace entries preserved; inactive condition absent from public exclusion evidence; existing unconditional behavior remains. Use realistic canonical IO/CLI/filesystem tests, no internet. Keep source IDs only in fixtures/data, never production branches. Run affected suites plus typecheck and relevant formatting. Parent runs full final gate.

## Report

No subagents. No git commits/pushes, direct DB writes, real cache changes or pipeline operations. Report modified files, RED and GREEN evidence, covering command/output, concerns and scope to `.superpowers/sdd/plan/task-4-report.md`. Return concise status. Preserve other existing staged/committed roster work and external branch changes.
