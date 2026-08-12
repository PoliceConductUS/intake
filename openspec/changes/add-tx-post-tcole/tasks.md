## 1. Phase A — TCOLE source config (existing kinds)

- [ ] 1.0 Add input classification to `sources/gov.tx.tcole/config.ts` (mirroring `census-gazetteer`'s `matchInputs`): detect the 02-10/SMALL workbook (sheets `Departments`/`Officers`/`Services`) vs the 02-04/BIG workbook (`Sheet1` + `Active Depts.`), so the same source module emits Agency+Personnel+AgencyPersonnel for SMALL and Personnel+LicenseAction for BIG.
- [ ] 1.1 In the 02-10 branch: `run(deps)` reads the workbook via `deps.readXlsx`, iterates the `Officers` sheet, emits Personnel keyed by `PUBLIC_GUID` (first/last/middle/suffix). Deterministic.
- [ ] 1.2 Add Agency emission from the `Departments` sheet keyed by `DEPARTMENT_NUMBER` (name, state, city, address, zip_code, contact_name, contact_email, phones); do NOT emit slug/location_path_id/latitude/longitude.
- [ ] 1.3 Add AgencyPersonnel emission from the `Services` sheet: build the synthetic key `PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE` (dates `YYYY-MM-DD`, empty when null); set `agency_id`=DEPARTMENT_NUMBER, `personnel_id`=PUBLIC_GUID, start_date, end_date, license_type.
- [ ] 1.4 Enforce referential integrity: skip/guard Services rows whose department or officer is absent from the emitted Agency/Personnel maps; assert no dangling references.
- [ ] 1.5 Write `test/sources/gov.tx.tcole/run.test.ts` (synthetic fixtures): record shapes, deterministic re-run, and an explicit assertion that the AgencyPersonnel key equals the abandoned map's `id_field` format for both null and non-null end dates.

## 2. Phase A — Canonical ID preservation (ledger seed)

- [ ] 2.1 Create a ledger-seed tool that reads the abandoned `identity/sources/tcole/{agencies,personnel,agency-officers}.yaml`, builds a `SourceNameToCanonicalIds` object (agencies/personnel/agencyPersonnel), and calls `persistSourceNameToCanonicalIds("gov.tx.tcole", …)`.
- [ ] 2.2 Add a round-trip test: seed a small maps fixture, then `loadSourceNameToCanonicalIds("gov.tx.tcole")` returns the same key→canonicalId mappings.
- [ ] 2.3 Run the seed tool against the real maps into the dev workspace; record the counts (expect ~2,950 agencies, ~129,968 personnel, ~143,694 agencyPersonnel) in verify.md.

## 3. Phase A — SMALL-only end-to-end reconstruction

- [ ] 3.1 Confirm `intake run gov.tx.tcole` with the 02-10/SMALL file composes: source module loads, artifacts envelope builds, `runImportArtifactsCommand` is invoked with the Census resolver defaulted on.
- [ ] 3.2 Dry-run the SMALL import; reconcile planned Agency/Personnel/AgencyPersonnel counts against the abandoned manifest; spot-check that seeded entities resolve to their existing canonical IDs (no new IDs minted) and that `license_type` holds the APPOINTMENT/role value.
- [ ] 3.3 Record the SMALL reconstruction result (counts, preserved-ID spot-checks, any geocode misses) in verify.md.

## 3b. Phase B prerequisite — verify additive load semantics

- [ ] 3b.1 Read `plan-database-mutations.ts` and confirm a run's artifacts are applied as additive upserts only — entities absent from the current run's artifacts are NOT deleted (disappearance = no-op). Document the finding in design.md/verify.md.
- [ ] 3b.2 If the pipeline reconciles-by-deletion, STOP and resolve (scope an additive/partial-run mode) before Run 2 — the two-run model depends on this.

## 4. Phase B — LicenseAction kind (pipeline extension)

- [ ] 4.1 Add a Supabase migration creating `license_action` (personnel FK, license, action, action_date, award_date, status, description) with explicit checked-in IDs; refresh generated types.
- [ ] 4.2 Add `LicenseActionSpec` + generated record schema; register `LicenseActions`/`LicenseAction` in `importTypeRegistry` with correct `dependsOn` (Personnel).
- [ ] 4.3 Extend `src/cli/state/source-name-to-canonical-id/index.ts` with the fifth entity (LicenseAction) across load/persist/resolve/assert.
- [ ] 4.4 Extend `transform.ts` + `plan-database-mutations.ts` to build and plan `license_action` rows (resolve `personnel_id` via the ledger; mint fresh cuids).
- [ ] 4.5 Add pipeline tests covering LicenseAction transform + that the existing four kinds are unaffected.

## 5. Phase B — BIG emission + ordered two-run reconstruction

- [ ] 5.1 Extend the source config's 02-04/BIG branch to read `Sheet1` `1.person` rows (Personnel) and `3.license` rows (LicenseAction keyed by a stable synthetic tuple, `personnel_id`=PUBLIC_GUID).
- [ ] 5.2 Source tests for BIG-branch emission (Personnel + LicenseAction shape + deterministic) on synthetic fixtures.
- [ ] 5.3 Ordered reconstruction: run oldest-first — Run 1 `intake run gov.tx.tcole` with BIG (Personnel + ~310k LicenseActions), then Run 2 with SMALL (Agency + AgencyPersonnel + superset Personnel). Confirm counts.
- [ ] 5.4 Verify additive preservation across the ordered runs: after the SMALL run, BIG's Personnel and LicenseAction rows and their IDs are unchanged; on the 26 name-conflict officers, SMALL (newer) wins. Record in verify.md.
