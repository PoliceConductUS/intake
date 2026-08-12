## 1. Phase A — Source config (employment kinds) + rename

- [ ] 1.0 Scaffold `sources/gov.tx.tcole/config.ts` `run(deps)`: read the single 02-10 workbook's sheets (`Departments`/`Officers`/`Services`/`OfficersLicensesActions`) via `deps.readXlsx`.
- [ ] 1.1 Emit Personnel keyed by `PUBLIC_GUID` (first/last/middle/suffix). Deterministic.
- [ ] 1.2 Emit Agency from `Departments` keyed by `DEPARTMENT_NUMBER` (name/state/city/address/zip/contact_name/contact_email/phones); do NOT emit slug/location_path_id/lat/lng.
- [ ] 1.3 Emit Assignment (AgencyPersonnel) from `Services` — key `PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE`; `title`=APPOINTMENT, `agency_id`=DEPARTMENT_NUMBER, `personnel_id`=PUBLIC_GUID, start/end dates, `license` ref = `PUBLIC_GUID|LICENSE`.
- [ ] 1.4 Add the `agency_officers.license_type`→`title` rename migration (idempotent; keep NOT NULL) + add nullable `license_id`; refresh generated types + `AgencyPersonnelSpec` (`title`, `license` ref).
- [ ] 1.5 Referential-integrity guard: every DEPARTMENT_NUMBER/PUBLIC_GUID an Assignment references is emitted; assert no dangling refs.
- [ ] 1.6 `test/sources/gov.tx.tcole/run.test.ts`: record shapes, determinism, and an explicit assertion that the Assignment key matches the abandoned map's `id_field` and `title`=APPOINTMENT (not LICENSE).

## 2. Phase A — Canonical ID preservation (ledger seed)

- [ ] 2.1 Ledger-seed tool: read the abandoned `identity/sources/tcole/{agencies,personnel,agency-officers}.yaml`, build a `SourceNameToCanonicalIds` object, and call `persistSourceNameToCanonicalIds("gov.tx.tcole", …)`.
- [ ] 2.2 Round-trip test: seed a small maps fixture, then `loadSourceNameToCanonicalIds("gov.tx.tcole")` returns the same mappings.
- [ ] 2.3 Run the seed tool against the real maps into the dev workspace; record counts (~2,950 agencies / ~129,968 personnel / ~143,694 agency-officers) in verify.md.

## 3. Phase A — Employment reconstruction

- [ ] 3.1 Confirm `intake run gov.tx.tcole` composes (source loads, envelope builds, Census resolver defaulted on).
- [ ] 3.2 Dry-run; reconcile Agency/Personnel/Assignment counts against the abandoned manifest; spot-check preserved canonical IDs and that `title` holds the role.
- [ ] 3.3 Record the employment reconstruction result in verify.md.

## 3b. Phase B prerequisite — verify additive load

- [ ] 3b.1 Read `plan-database-mutations.ts`; confirm a run's artifacts apply as additive upserts only (absent entities are NOT deleted). Document in verify.md.
- [ ] 3b.2 If the pipeline reconciles-by-deletion, STOP and resolve before Phase B.

## 4. Phase B — Licensing model (schema + pipeline)

- [ ] 4.1 Migrations: `licensing_authority` (name, location_path_id); `license` (officer_id, license_type, status, first_awarded, issued_by_authority_id FK, unique(officer_id,license_type)); `license_action` (license_id FK, action, action_date, status). Explicit checked-in IDs; refresh generated types.
- [ ] 4.2 Add `LicensingAuthoritySpec`, `LicenseSpec`, `LicenseActionSpec` + generated record schemas; register the three kinds in `importTypeRegistry` with correct `dependsOn` (License→LicensingAuthority+Personnel; LicenseAction→License; Assignment→License).
- [ ] 4.3 Extend `source-name-to-canonical-id/index.ts` with the three new entity blocks (load/persist/resolve/assert).
- [ ] 4.4 Extend `transform.ts` + `plan-database-mutations.ts`: build licensing_authority/license/license_action rows; resolve License `issued_by_authority_id` (LicensingAuthority ledger) and Assignment `license_id` (License ledger); mint fresh cuids for the new entities.
- [ ] 4.5 Pipeline tests for the three new kinds + Assignment `license_id`, and that the pre-existing kinds are unaffected.

## 5. Phase B — Licensing emission + full single-run reconstruction

- [ ] 5.1 Extend the config to emit LicensingAuthority (TCOLE, `/tx/`), License (distinct `PUBLIC_GUID`×`LICENSE` across `OfficersLicensesActions`+`Services`, issued_by TCOLE), and LicenseAction (`OfficersLicensesActions`, keyed `PUBLIC_GUID|LICENSE|ACTION|ACTION_DATE`); set each Assignment's `license` ref.
- [ ] 5.2 Source tests for LicensingAuthority/License/LicenseAction shapes + determinism, and that Assignment `license` refs resolve to emitted Licenses.
- [ ] 5.3 Full reconstruction: one `intake run gov.tx.tcole` emits all six kinds. Confirm counts (incl. ~189k license actions) and that assignment `license_id` + license `issued_by_authority_id` resolve.
- [ ] 5.4 Record the full reconstruction result (counts, preserved IDs, license linkage) in verify.md.
