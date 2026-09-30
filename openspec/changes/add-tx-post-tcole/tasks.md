> **Verified 2026-09-29.** Real workbook transformation, current database comparison,
> historical identity-ledger reconciliation, and license-link verification are
> complete. The former `intake run` workflow is now `data transform` followed by
> `data generate` and, only for a nonempty delta, `data up`. See the current
> verification section in `verify.md`; older task descriptions retain historical
> names for provenance.

## 1. Phase A — Source config (employment kinds) + rename

- [x] 1.0 Scaffold `sources/gov.tx.tcole/config.ts` `run(deps)`: read the single 02-10 workbook's sheets via `deps.readXlsx`. _Reads `Departments`/`Officers`/`Services`; `OfficersLicensesActions` is only needed for licensing and is wired in Phase B (5.1)._
- [x] 1.1 Emit Personnel keyed by `PUBLIC_GUID` (first/last/middle/suffix). Deterministic.
- [x] 1.2 Emit Agency from `Departments` keyed by `DEPARTMENT_NUMBER` (name/state/city/address/zip/contact_name/contact_email/phones); do NOT emit slug/location_path_id/lat/lng.
- [x] 1.3 Emit Assignment (AgencyPersonnel) from `Services` — key `PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE`, `agency_id`=DEPARTMENT*NUMBER, `personnel_id`=PUBLIC_GUID, start/end dates. \_Role is currently stored in `license_type` (=APPOINTMENT); the `title` rename and the `license` ref are deferred to 1.4/Phase B.*
- [x] 1.4 `agency_officers.license_type`→`title` rename migration (`20260627000000`, idempotent, keeps NOT NULL) + nullable `license_id` column (FK added with the `license` table in Phase B); generated types refreshed; `AgencyPersonnelSpec` field renamed to `title`. Config emits `title` (blank `APPOINTMENT`→`"Unknown"`, value only — the key keeps the empty segment). _The `license` ref emission + resolution lands in Phase B (5.1/4.4) when License entities exist._
- [x] 1.5 Referential-integrity guard: every DEPARTMENT_NUMBER/PUBLIC_GUID an Assignment references is emitted (config only emits Assignments whose agency and officer were emitted).
- [x] 1.6 `test/sources/gov.tx.tcole.test.ts`: record shapes, determinism, and an explicit assertion that the Assignment key matches the abandoned map's `id_field` and the role=APPOINTMENT (asserted on `license_type`, pending the 1.4 rename).

## 2. Phase A — Canonical ID preservation (ledger seed)

- [x] 2.1 Ledger-seed tool (`scripts/seed-tcole-ledger.ts`): read the abandoned `identity/sources/tcole/{agencies,personnel,agency-officers}.yaml`, build a `SourceNameToCanonicalIds` object, and call `persistSourceNameToCanonicalIds("gov.tx.tcole", …)`.
- [x] 2.2 Round-trip test (`test/cli/state/seed-from-identity-maps.test.ts`): seed a small maps fixture, then `loadSourceNameToCanonicalIds("gov.tx.tcole")` returns the same mappings.
- [x] 2.3 Verify the real maps against the already-populated dev-copy ledger: 2,950 agencies, 129,973 personnel, and 143,699 assignments all retain their canonical IDs. Do not overwrite the established ledger by reseeding it.

## 3. Phase A — Employment reconstruction

- [x] 3.1 Run the preserved 02-10 workbook through the current `data transform gov.tx.tcole` command; verify authority location `/tx/` and successful composition.
- [x] 3.2 Run `data generate gov.tx.tcole`; reconcile actual artifact and chain counts, every historical mapping, and all retained historical assignment roles. Result: empty diff.
- [x] 3.3 Record the employment reconstruction results and audit paths in verify.md.

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

- [x] 5.0 **No curated list** (superseded by [ADR 0015](../../../docs/adr/0015-isolate-namespaces-and-own-cross-source-identity-at-root.md)). Namespaces are isolated and self-contained: a source emits only the authorities it processes, with its own namespace-local names. `gov.tx.tcole` emits exactly one authority — TCOLE — in-source. The DB's authorities end up being {TCOLE, AZ POST, MN POST}, one per POST source; cross-source unification is a future root-level dedup concern (ADR 0008). The shared/curated `licensing-authorities.ts` file was deleted.
- [x] 5.1 Config emits the TCOLE LicensingAuthority (keyed `tcole`; `location_path_id` = the namespace-local state value `"tx"`, which the intake root resolves to the canonical TX location_path via `getByPath`, resolve-or-fail per ADR 0006 — not the ledger), License (distinct `PUBLIC_GUID`×`LICENSE` across `OfficersLicensesActions`+`Services` for emitted officers, `issued_by`=`tcole` resolved in-namespace, `first_awarded`=earliest action date), and LicenseAction (`OfficersLicensesActions`, keyed `PUBLIC_GUID|LICENSE|ACTION|ACTION_DATE`); each Assignment sets `license_id` (null when blank or un-emitted). Emit order dependency-respecting.
- [x] 5.2 Source tests assert LicensingAuthority/License/LicenseAction shapes + determinism, Assignment `license_id` resolves to an emitted License (and is null for the blank-LICENSE row), and actions for dropped officers are not emitted.
- [x] 5.3 Verify the real workbook produces the six original kinds plus AuthorityLicenses and AgencyPhoneNumbers; check all reconstructed records are present and assignment/license/authority links resolve through the current AuthorityLicense model.
- [x] 5.4 Record full counts, preserved mappings, source hash, license linkage, exclusions, and unchanged database evidence in verify.md.
