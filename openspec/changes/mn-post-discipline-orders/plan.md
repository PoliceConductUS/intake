# MN POST person-level discipline and education implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Import MN POST discipline against its person and issuer, populate available order details, and import education completions.

**Architecture:** Extend the existing generated database contracts and shared import pipeline. Keep downloads/OCR/analysis in acquire; transform emits deterministic source records. Preserve canonical source names and stored history.

**Tech Stack:** TypeScript, PostgreSQL/Supabase, Zod generated envelopes, Vitest, existing Playwright/PDF/Anthropic acquisition.

**Spec:** `openspec/changes/mn-post-discipline-orders/specs/mn-post-discipline-orders/spec.md`

## Global Constraints

- Intake never deletes records. Preserve existing canonical IDs and slugs.
- No viewer changes or production migration execution in this work.
- Discipline identifies the person and licensing authority; do not infer a license or assignment.
- Every YAML envelope uses canonical IO. New IDs use the persisted source-name ledger.
- Missing identity, conflicting duplicate records, and failed writes fail loudly.
- Unavailable linked documents are reported and retain nullable unavailable details.
- No new dependencies, source-ID special cases, or fallback behavior.

### Task 1: Schema and shared contracts

**Files:** create `supabase/migrations/20260927000001_personnel_discipline_education.sql`; modify `scripts/lib/entity-spec-generator.ts`, generated IO/mutations/row types, `src/cli/import/artifacts/agency-graph.ts`; add migration integration tests and extend `test/import/artifacts/agency-graph.test.ts`.

**Interfaces:** Produce required `DisciplineSpec.personnel_id` and `.licensing_authority_id`, optional nullable `.document_url`; `PersonnelEducationSpec` and plural artifact `PersonnelEducations`.

- [ ] Write failing schema/graph tests. Test old action ID preservation, unique person/issuer backfill, ambiguous backfill rollback, valid/new required FKs, and personnel traversal without another agency.
- [ ] Run the focused tests and record the expected RED.
- [ ] Add migration with required person/issuer FKs after checking/backfilling unique existing relationships. Retain old relationship tables/rows. Add nullable nonblank document_url.
- [ ] Create personnel_education with explicit text id PK, required personnel_id FK and nonblank name; nullable completion_date date, credits numeric, sponsor_name text, sponsor_instructor text; existing timestamp/RLS conventions. Omit the three source completions with null names and report each source ID and reason. Add generated descriptor `{recordKind: "PersonnelEducation", table: "personnel_education", createRequired: ["id"]}`. Add graph edges `{parent: "Personnel", child: "Discipline", holder: "child", field: "personnel_id"}` and corresponding PersonnelEducation edge.
- [ ] Apply all migrations in an isolated test database, generate contracts from that schema, and run focused tests/typecheck. Do not reset or mutate the audited local database.
- [ ] Commit the scoped schema/contracts/tests and report RED/GREEN evidence.

### Task 2: MN POST transform

**Files:** `sources/mn-post/transform.ts`, `test/sources/mn-post.test.ts`; source-only helpers if needed to keep education validation separate.

**Interfaces:** Consume Task 1 generated contracts. Produce `PersonnelEducations` keyed by courseId and `Disciplines` keyed by the existing contactId|caseNumber source name. Use the same issuer source name as LicensingAuthorities.

- [ ] Add failing fixtures for a person with two licenses and multiple assignments: action attaches only to person/issuer. Assert no newly inferred DisciplineAgencyPersonnel/CoverageLinkAgencyPersonnel records. Assert document_url and five existing detail fields.
- [ ] Add failing education fixture with `courseId: "course-1", contactId: "0031", name: "Training", endDate: "2026-08-16", credits: 1, sponsorname: "Sponsor", sponsorInstructor: null`. Expect corresponding source record with personnel_id "0031", completion_date "2026-08-16", sponsor_name "Sponsor". Add missing/unknown identity and conflicting duplicate tests.
- [ ] Run source tests for RED. Implement deterministic joins; source arrays with no records remain empty. Do not use disciplinaryAction boolean to filter real actions.
- [ ] Preserve existing discipline source names. Compare duplicate case entries' action/dates and available document hashes/analysis; identical evidence may coalesce, conflicts must fail naming case. Preserve raw entries untouched.
- [ ] Run focused tests/typecheck and commit. Resolve any existing fixture expectations affected by the approved semantics, without weakening unrelated validation.

### Task 3: Available order documents and live import

**Files:** existing acquisition modules/tests only if a demonstrated defect requires correction; write operational receipts under `$INTAKE_WORKSPACE/audits/mn-post-details-20260927/`; update this change's validation artifacts.

**Interfaces:** Use existing data acquire/transform/generate/up CLI and generated schema from Tasks 1-2. Use document JSON `{url,sha256,text,analysis,analyzedWith}` from existing acquisition, preserving every raw PDF.

- [ ] Back up audited local database and record pre-import IDs/slugs/counts. Verify target host 127.0.0.1 port 54322 before any write.
- [ ] Resume acquisition. Download available documents and report unavailable ones. Missing analysis credentials must be reported; do not fabricate analysis or silently claim completion.
- [ ] Review downloaded-order extraction against source text. Preserve model/prompt/hash provenance for populated fields.
- [ ] Apply reviewed migration incrementally to local; run normal transform/generate/up. Resumed acquisition education inventory is 1,769,993 records (1,769,990 after the three approved omissions); reconcile actual retained/imported counts and explain graph exclusions.
- [ ] Verify all previous durable IDs/slugs remain; new FKs resolve; updated source fields were compared/applied; document detail counts and unavailable cases are reported. Check repeat generation is a no-op after comparison.
- [ ] Run focused tests, typecheck/build, OpenSpec validation, independent review, and record actual results. Do not mark live task complete while blocked on document analysis or import.
