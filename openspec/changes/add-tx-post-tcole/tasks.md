> **Reconciled 2026-08-13** against committed work (`7a6d9e4`…`d636958`). Phase A
> source + ledger + employment import are landed and unit-tested; the Phase A
> **real-data run capture** (2.3, 3.1–3.3, 3b.1) and all of Phase B remain open.
> See `verify.md`.

## 1. Phase A — Source config (employment kinds) + rename

- [x] 1.0 Scaffold `sources/gov.tx.tcole/config.ts` `run(deps)`: read the single 02-10 workbook's sheets via `deps.readXlsx`. _Reads `Departments`/`Officers`/`Services`; `OfficersLicensesActions` is only needed for licensing and is wired in Phase B (5.1)._
- [x] 1.1 Emit Personnel keyed by `PUBLIC_GUID` (first/last/middle/suffix). Deterministic.
- [x] 1.2 Emit Agency from `Departments` keyed by `DEPARTMENT_NUMBER` (name/state/city/address/zip/contact_name/contact_email/phones); do NOT emit slug/location_path_id/lat/lng.
- [x] 1.3 Emit Assignment (AgencyPersonnel) from `Services` — key `PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE`, `agency_id`=DEPARTMENT_NUMBER, `personnel_id`=PUBLIC_GUID, start/end dates. _Role is currently stored in `license_type` (=APPOINTMENT); the `title` rename and the `license` ref are deferred to 1.4/Phase B._
- [ ] 1.4 Add the `agency_officers.license_type`→`title` rename migration (idempotent; keep NOT NULL) + add nullable `license_id`; refresh generated types + `AgencyPersonnelSpec` (`title`, `license` ref). _NOT done. A legacy migration (`20260626000000`) renamed the column the **wrong** direction (`title`→`license_type`); this task must rename it back and add `license_id`._
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

- [ ] 3b.1 Read `plan-database-mutations.ts`; confirm a run's artifacts apply as additive upserts only (absent entities are NOT deleted). Document in verify.md.
- [ ] 3b.2 If the pipeline reconciles-by-deletion, STOP and resolve before Phase B.

## 4. Phase B — Licensing model (schema + pipeline)

- [ ] 4.1 Migrations: `licensing_authority` (name, abbreviation, website, location_path_id); `license` (officer_id, license_type, status, first_awarded, issued_by_authority_id FK, unique(officer_id,license_type)); `license_action` (license_id FK, action, action_date, status). Explicit checked-in IDs; refresh generated types.
- [ ] 4.2 Add `LicensingAuthoritySpec`, `LicenseSpec`, `LicenseActionSpec` + generated record schemas; register the three kinds in `importTypeRegistry` with correct `dependsOn` (License→LicensingAuthority+Personnel; LicenseAction→License; Assignment→License).
- [ ] 4.3 Extend `source-name-to-canonical-id/index.ts` with the three new entity blocks (load/persist/resolve/assert).
- [ ] 4.4 Extend `transform.ts` + `plan-database-mutations.ts`: build licensing_authority/license/license_action rows; resolve License `issued_by_authority_id` (LicensingAuthority ledger) and Assignment `license_id` (License ledger); mint fresh cuids for the new entities.
- [ ] 4.5 Pipeline tests for the three new kinds + Assignment `license_id`, and that the pre-existing kinds are unaffected.

## 5. Phase B — Licensing emission + full single-run reconstruction

- [ ] 5.0 Create the curated `licensing-authorities` reference file (~55 US POST agencies: `key`, `name`, `abbreviation`, `state`, `website`) checked into the source, normalized from public directories (IADLEST, Army "States' POST" list, agency sites).
- [ ] 5.1 Extend the config to emit LicensingAuthority for every curated-file row (keyed by `key`; `location_path_id` resolved to the gazetteer `/state/` path), License (distinct `PUBLIC_GUID`×`LICENSE` across `OfficersLicensesActions`+`Services`, `issued_by`=TCOLE), and LicenseAction (`OfficersLicensesActions`, keyed `PUBLIC_GUID|LICENSE|ACTION|ACTION_DATE`); set each Assignment's `license` ref.
- [ ] 5.2 Source tests for LicensingAuthority/License/LicenseAction shapes + determinism, and that Assignment `license` refs resolve to emitted Licenses.
- [ ] 5.3 Full reconstruction: one `intake run gov.tx.tcole` emits all six kinds. Confirm counts (incl. ~189k license actions) and that assignment `license_id` + license `issued_by_authority_id` resolve.
- [ ] 5.4 Record the full reconstruction result (counts, preserved IDs, license linkage) in verify.md.
