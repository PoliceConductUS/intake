# TX POST (TCOLE) Reconstruction — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement
> this plan task-by-task. Read `design.md`, `tasks.md`, and `specs/**` for detail;
> this plan gives the order, files, and acceptance per task.

**Goal:** Add a config-driven TCOLE source (`gov.tx.tcole`) that reconstructs the
TX rows of the production DB from two TCOLE workbooks with preserved canonical IDs,
and introduces the corrected licensing model (LicensingAuthority / License /
LicenseAction + Assignment `title`/`license`).

**Architecture:** One source module, a single `intake run gov.tx.tcole` reading the
02-10 workbook (the 02-04 interim export is excluded). The existing import pipeline
(Census geocode → location_path → ResolvedProperty, ledger ID resolution, additive
load) is reused unchanged for the employment kinds; the pipeline is extended
additively with three licensing kinds. IDs are preserved by seeding the
`SourceNameToCanonicalId` ledger from the prior TCOLE identity maps.

**Tech Stack:** TypeScript ESM, exceljs (via `deps.readXlsx`), Zod entity specs,
Supabase/PostgreSQL migrations, cuid2, Vitest.

## Global Constraints

- `run()` is deterministic: no network, clock, or randomness.
- Ledger key = emitted record key (identity); reader keys off `metadata.name`.
- `agency_officers.title` (renamed from `license_type`) holds the **role**
  (`APPOINTMENT`), NOT the license; it is NOT NULL. `license` is a separate ref.
- Assignment identity key = `PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE`
  (dates `YYYY-MM-DD`, empty segment when null) — must match the prior map's `id_field`.
- Seed data fails loudly on duplicates; no ON CONFLICT/upsert-hiding; migration IDs explicit + checked in.
- New licensing entities get fresh cuid2; existing agency/officer/assignment IDs are preserved.

---

## Phase A — Existing-DB reconstruction + rename

### Task A1: Source scaffold + employment emission
- **Files:** create `sources/gov.tx.tcole/config.ts`; test `test/sources/gov.tx.tcole/run.test.ts`.
- [ ] `run(deps)` reads the 02-10 workbook's sheets via `deps.readXlsx`.
- [ ] Emit Personnel (`PUBLIC_GUID`), Agency (`DEPARTMENT_NUMBER`, address fields, no slug/location/lat/lng), Assignment (synthetic key; `title`=APPOINTMENT; `agency_id`/`personnel_id` source keys; `license` ref=`PUBLIC_GUID|LICENSE`; start/end).
- [ ] Referential-integrity guard: no Assignment references an un-emitted agency/officer.
- [ ] Tests: shapes, determinism, key-format == `id_field`, `title`==APPOINTMENT. Run `npm run test -- gov.tx.tcole`.

### Task A2: Rename migration + AgencyPersonnel spec
- **Files:** `supabase/migrations/*_agency_officers_add_license_id.sql`; regenerate `src/shared/io/generated/entity-specs.ts` (or edit generator input).
- [ ] Idempotent: ensure `license_type`→`title` rename already exists (migration `20260626000000`), add nullable `license_id` FK.
- [ ] `AgencyPersonnelSpec`: `title` (required) + `license` ref field; regenerate types.
- [ ] Verify existing rows/IDs unchanged.

### Task A3: Ledger-seed tool
- **Files:** create `src/cli/**/seed-tcole-ledger.ts` (or a scripts entry); test alongside.
- [ ] Read abandoned `identity/sources/tcole/{agencies,personnel,agency-officers}.yaml`, build `SourceNameToCanonicalIds`, call `persistSourceNameToCanonicalIds("gov.tx.tcole", …)`.
- [ ] Round-trip test: seed fixture → `loadSourceNameToCanonicalIds` returns same maps.
- [ ] Run against real maps; record counts in `verify.md`.

### Task A4: Employment reconstruction (acceptance)
- [ ] `intake run gov.tx.tcole` dry-run composes with the Census resolver defaulted.
- [ ] Reconcile Agency/Personnel/Assignment counts vs the abandoned manifest; spot-check preserved IDs + `title` role. Record in `verify.md`.

---

## Phase B — Licensing model

### Task B1: Additive-load verification (gate)
- [ ] Read `plan-database-mutations.ts`; confirm additive upsert (no delete of absent entities). If reconcile-by-deletion, STOP and escalate. Document in `verify.md`.

### Task B2: Licensing schema
- **Files:** `supabase/migrations/*_licensing_authority.sql`, `*_license.sql`, `*_license_action.sql`; regenerate types.
- [ ] `licensing_authority(name, abbreviation, website, location_path_id)`; `license(officer_id, license_type, status, first_awarded, issued_by_authority_id, unique(officer_id,license_type))`; `license_action(license_id, action, action_date, status)`. Explicit IDs.

### Task B3: Register three kinds + specs
- **Files:** `src/shared/io/import-types.ts`, generated specs.
- [ ] `LicensingAuthoritySpec`/`LicenseSpec`/`LicenseActionSpec` + record schemas; registry entries with `dependsOn` (License→LicensingAuthority+Personnel; LicenseAction→License; AgencyPersonnel→…+License).

### Task B4: Ledger + transform plumbing
- **Files:** `src/cli/state/source-name-to-canonical-id/index.ts`, `src/cli/import/artifacts/transform.ts`, `plan-database-mutations.ts`.
- [ ] Add the three entity blocks (load/persist/resolve/assert).
- [ ] Build authority/license/license_action rows; resolve License `issued_by_authority_id` and Assignment `license_id` via the ledger; fresh cuids for new entities.
- [ ] Tests for new kinds + Assignment `license_id`; assert existing kinds unaffected.

### Task B5: Licensing emission + full reconstruction (acceptance)
- [ ] Create the curated `licensing-authorities` reference file (~55 US POST agencies) and emit a LicensingAuthority per row (`location_path_id` → gazetteer `/state/`).
- [ ] Emit License (distinct `PUBLIC_GUID`×`LICENSE` across `OfficersLicensesActions`+`Services`, issued_by TCOLE), LicenseAction (`OfficersLicensesActions`). Tests.
- [ ] One `intake run gov.tx.tcole` emits all six kinds. Confirm ~189k license actions, assignment `license_id` + license `issued_by_authority_id` resolve. Record in `verify.md`.
