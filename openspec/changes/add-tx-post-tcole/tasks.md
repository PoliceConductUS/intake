> **Updated 2026-08-13.** Phase A source/ledger/employment import + the
> `license_type`→`title` rename (1.4) are landed and unit-tested. Phase B
> (licensing model: 4.1–4.5, 5.1–5.2) is fully implemented and unit-tested
> (301 tests green, typecheck clean). Remaining: the curated authorities file is
> a verified subset to be grown to ~55 (5.0), and the **real-data run captures**
> (2.3, 3.1–3.3, 5.3–5.4) need the 02-10 workbook in a populated dev workspace.
> See `verify.md`.

## 1. Phase A — Source config (employment kinds) + rename

- [x] 1.0 Scaffold `sources/gov.tx.tcole/config.ts` `run(deps)`: read the single 02-10 workbook's sheets via `deps.readXlsx`. _Reads `Departments`/`Officers`/`Services`; `OfficersLicensesActions` is only needed for licensing and is wired in Phase B (5.1)._
- [x] 1.1 Emit Personnel keyed by `PUBLIC_GUID` (first/last/middle/suffix). Deterministic.
- [x] 1.2 Emit Agency from `Departments` keyed by `DEPARTMENT_NUMBER` (name/state/city/address/zip/contact_name/contact_email/phones); do NOT emit slug/location_path_id/lat/lng.
- [x] 1.3 Emit Assignment (AgencyPersonnel) from `Services` — key `PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE`, `agency_id`=DEPARTMENT_NUMBER, `personnel_id`=PUBLIC_GUID, start/end dates. _Role is currently stored in `license_type` (=APPOINTMENT); the `title` rename and the `license` ref are deferred to 1.4/Phase B._
- [x] 1.4 `agency_officers.license_type`→`title` rename migration (`20260627000000`, idempotent, keeps NOT NULL) + nullable `license_id` column (FK added with the `license` table in Phase B); generated types refreshed; `AgencyPersonnelSpec` field renamed to `title`. Config emits `title` (blank `APPOINTMENT`→`"Unknown"`, value only — the key keeps the empty segment). _The `license` ref emission + resolution lands in Phase B (5.1/4.4) when License entities exist._
- [x] 1.5 Referential-integrity guard: every DEPARTMENT_NUMBER/PUBLIC_GUID an Assignment references is emitted (config only emits Assignments whose agency and officer were emitted).
- [x] 1.6 `test/sources/gov.tx.tcole.test.ts`: record shapes, determinism, and an explicit assertion that the Assignment key matches the abandoned map's `id_field` and the role=APPOINTMENT (asserted on `license_type`, pending the 1.4 rename).

## 2. Phase A — Canonical ID preservation (ledger seed)

- [x] 2.1 Ledger-seed tool (`scripts/seed-tcole-ledger.ts`): read the abandoned `identity/sources/tcole/{agencies,personnel,agency-officers}.yaml`, build a `SourceNameToCanonicalIds` object, and call `persistSourceNameToCanonicalIds("gov.tx.tcole", …)`.
- [x] 2.2 Round-trip test (`test/cli/state/seed-from-identity-maps.test.ts`): seed a small maps fixture, then `loadSourceNameToCanonicalIds("gov.tx.tcole")` returns the same mappings.
- [ ] 2.3 Run the seed tool against the real maps into the dev workspace; record counts (~2,950 agencies / ~129,968 personnel / ~143,694 agency-officers) in verify.md. _Not captured — no real-data run recorded._

## 3. Phase A — Employment reconstruction

- [ ] 3.1 Confirm `intake run gov.tx.tcole` composes (source loads, envelope builds, Census resolver defaulted on). _Code path in place and unit-tested; a real run is not yet recorded._
- [ ] 3.2 Dry-run; reconcile Agency/Personnel/Assignment counts against the abandoned manifest; spot-check preserved canonical IDs and that the role field holds the role.
- [ ] 3.3 Record the employment reconstruction result in verify.md.

## 3b. Phase B prerequisite — verify additive load

- [x] 3b.1 Confirmed additive: `classify-database-operations.ts` only ever assigns `create`/`read`/`update`, iterating solely over rows present in the run — it never queries for or deletes absent entities. Planning runs in a rolled-back transaction; writes are plain `INSERT` (no `ON CONFLICT`/upsert), idempotent by canonical id. The only deletions are same-run referential cascades (`dropExcludedAgencyDependents`), not DB reconciliation. Documented in verify.md.
- [x] 3b.2 Not applicable — the pipeline does not reconcile-by-deletion (see 3b.1). Phase B is safe to proceed.

## 4. Phase B — Licensing model (schema + pipeline)

- [x] 4.1 Migration `20260627000100_add_licensing_tables.sql`: `licensing_authority` (name, abbreviation, website, location_path_id FK→location_path); `license` (officer_id FK→officers, license_type, status, first_awarded, issued_by_authority_id FK→licensing_authority, unique(officer_id,license_type)); `license_action` (license_id FK→license, action, action_date, status); plus the `agency_officers.license_id`→license FK. `text` PKs (pipeline supplies canonical ids). Generated types refreshed.
- [x] 4.2 `LicensingAuthoritySpec`/`LicenseSpec`/`LicenseActionSpec` (+CreateSpecs) added; `license_id` added to `AgencyPersonnelSpec`; three kinds registered in `importTypeRegistry`/`import-type-metadata`/`RECORD_ENVELOPE_KINDS` with `dependsOn` (LicensingAuthorities→LocationPaths; Licenses→LicensingAuthorities+Personnel; LicenseActions→Licenses; AgencyPersonnel→…+Licenses). `Artifacts.ts`/`index.ts` barrels + generated mutation envelopes wired.
- [x] 4.3 `source-name-to-canonical-id/index.ts` extended with the three entity blocks (types, `sourceNameKinds`, load/persist/assert/resolve); `seed-from-identity-maps.ts` given the three (empty) sections; `artifactsEntityKeys` union widened.
- [x] 4.4 `transform.ts` builds all three rows + resolves FKs by source key (LicensingAuthority `location_path_id` via the LocationPaths ledger as a `/state/` path string; License `officer_id`→personnel, `issued_by_authority_id`→licensingAuthorities; LicenseAction `license_id`→licenses; Assignment `license_id`→licenses, null-safe, no dangling refs), throwing on unmapped. `operations.ts`/`classify-database-operations.ts`/`plan-database-mutations.ts`/`data-context.ts`/`execute.ts` extended per kind. Fresh cuids minted by `resolveArtifactsSourceNameToCanonicalIds`.
- [x] 4.5 Pipeline tests extended (`plan-database-mutations`, `import-transform`, `data-context`, `source-name-to-canonical-id`) for the three kinds + Assignment `license_id`; no-upsert/rollback invariants still hold; pre-existing kinds unaffected (301 tests green).

## 5. Phase B — Licensing emission + full single-run reconstruction

- [~] 5.0 Curated `licensing-authorities.ts` module (`key`, `name`, `abbreviation`, `state`, `website`) checked into the source and imported by config. Ships a **verified subset** — TCOLE (TX) + AZ/CA/MN POST — deliberately NOT padded with unverified rows. _Remaining data task: complete to ~55 US POST agencies from IADLEST / Army "States' POST" list. The mechanism is done; only real rows are outstanding._
- [x] 5.1 Config emits LicensingAuthority for every curated-file row (keyed by `key`; `location_path_id` = `/state/` path string), License (distinct `PUBLIC_GUID`×`LICENSE` across `OfficersLicensesActions`+`Services` for emitted officers, `issued_by`=`tcole`, `first_awarded`=earliest action date), and LicenseAction (`OfficersLicensesActions`, keyed `PUBLIC_GUID|LICENSE|ACTION|ACTION_DATE`); each Assignment sets `license_id` (null when blank or un-emitted). Emit order dependency-respecting.
- [x] 5.2 Source tests assert LicensingAuthority/License/LicenseAction shapes + determinism, Assignment `license_id` resolves to an emitted License (and is null for the blank-LICENSE row), and actions for dropped officers are not emitted.
- [ ] 5.3 Full reconstruction: one `intake run gov.tx.tcole` emits all six kinds. Confirm counts (incl. ~189k license actions) and that assignment `license_id` + license `issued_by_authority_id` resolve. _PENDING — needs the real 02-10 workbook in a populated dev workspace (with census-gazetteer LocationPaths imported so `/tx/` resolves)._
- [ ] 5.4 Record the full reconstruction result (counts, preserved IDs, license linkage) in verify.md. _PENDING — depends on 5.3._
