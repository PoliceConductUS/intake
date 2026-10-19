# Intake completion implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Prevent incomplete intake work from advancing and recover MN POST document narratives.

**Architecture:** Shared command handoffs enforce completed acquisition and transform outputs. Source transform enforces document evidence completeness. Existing intake mutation chain applies a reviewed forward data correction.

**Tech Stack:** TypeScript, Node, Vitest, canonical intake IO, PostgreSQL.

**Spec:** specs/intake-stage-completion/spec.md and design.md in this change.

## Global Constraints

No website code changes, new dependencies, reset, identity changes, unrelated edits, or creation of the 34 unresolved personnel. Source name-specific shared pipeline branches are prohibited. Preserve historical chain and evidence. User already authorized implementation and publication.

## Review Focus

- Failed new transforms must not expose old artifacts as current.
- Local inputs with an acquire module must not become completed before that module succeeds.
- Changing source files or output artifacts invalidates the successful handoff.
- Null fields in complete analysis differ from unprocessed evidence.
- Explicit standalone/manual sources remain usable without network acquisition.

### Task 1: Enforce intake handoffs and document completeness

**Files:** src/cli/acquire/{index,acquire-from-local}.ts, src/cli/transform/{index,load-source-module}.ts, src/cli/data/source-pipeline.ts, src/cli/import/artifacts/index.ts, a narrow shared state adapter as needed, sources/mn-post/{transform.ts,acquire/collect-documents.ts}, corresponding tests and README.md.

**Interfaces:** Existing source acquire and transform APIs remain the source boundary. Successful handoff state binds acquired input digest and artifact output integrity; expose a single shared validation adapter to generation and internal import. Import result must identify its mutation file explicitly instead of callers searching all previous commands.

- [ ] Write regressions for all spec scenarios, including failure before mutation creation; run them and record expected failures.
- [ ] Implement the smallest shared handoff checks and source evidence validation. Reuse existing canonical IO for all envelopes; any new plain state record has explicit validated structure and a single IO adapter.
- [ ] Update existing tests and fixtures for the intentionally required new completion contract; do not add compatibility fallbacks.
- [ ] Run focused tests, typecheck, full validation and independent review. Record commands/results and commit scoped changes.

### Task 2: Regenerate and publish MN POST evidence

**Files:** New audit directory and command outputs under /Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev-copy; verification artifacts in this change.

**Interfaces:** Consume Task 1 enforced acquire/transform/generate workflow and existing source identity mappings. Never reuse helper bypasses. Existing Oregon worktree chain code supports the applied lineage; preserve it unchanged.

- [ ] Retain current snapshots, run complete source acquisition against cached input, retrieve/OCR/review every available linked order, and record explicit failures.
- [ ] Generate canonical artifacts and a forward delta; inspect narrative changes against source evidence and verify preserved IDs/slugs and unresolved records before apply.
- [ ] Apply and verify the chain and dataset. Record actual coverage, limitations and evidence.
- [ ] Complete verify/retrospective/archive; merge and remove worktree before website production build/deploy from main.
- [ ] Verify published records and report actual outcome.

### Task 1 follow-up: Enforce semantic extraction accounting

- [x] Add regression-first coverage for missing/blank null reasons, reasons attached to populated narratives, automated and Codex cache paths, and old completed-document reuse.
- [x] Require field-specific absence reasons separate from public narratives, raise the prompt contract version, and clarify stated allegation bases and finding attribution.
- [ ] Validate relevant/full tests and build, report limits honestly, and commit scoped implementation without changing actual recovery data or runtime generated metadata.
