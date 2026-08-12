## Why

Intake cannot yet reconstruct the production database from external source files,
so `seed.sql` remains the source of truth. TX is ~86% of the DB's agencies and
~93% of officer-agency links, so a TCOLE source is the highest-leverage step
toward retiring the seed. Doing it now, right after the census-gazetteer
migration, reuses the just-built config-driven runtime and the existing
Census-geocode agency resolution — and captures ~121k license-action rows the
current seed never had.

## What Changes

**TX POST (TCOLE) source**
- From: no TCOLE source; TX rows exist only because `seed.sql` hand-loads them.
- To: `sources/gov.tx.tcole/config.ts` emits Agency/Personnel/AgencyPersonnel
  from the 02-10 TCOLE file; `intake run` reconstructs them with geocoded
  locations and preserved canonical IDs.
- Reason: make intake the loader so seed can retire.
- Impact: non-breaking; additive namespace `gov.tx.tcole`.

**Canonical ID preservation**
- From: canonical IDs only exist inside `seed.sql`.
- To: a one-time ledger-seed transcribes the prior TCOLE identity maps into the
  intake `SourceNameToCanonicalId` ledger so reconstruction reuses existing IDs.
- Reason: durable IDs must stay stable (URLs, references).
- Impact: writes ledger records under namespace `gov.tx.tcole`.

**Licensing model (new) + Assignment fix**
- From: the pipeline supports four kinds; no licensing authority/license tables;
  `agency_officers.license_type` mis-holds the role.
- To: rename `agency_officers.license_type`→`title` (+ nullable `license_id`); new
  `licensing_authority`/`license`/`license_action` tables and three new kinds
  (LicensingAuthority, License, LicenseAction); licenses `issued_by` an authority
  whose jurisdiction is a location_path subtree.
- Reason: model TCOLE as a licensor (distinct from employers), capture the license
  history the seed discarded, and correct the mis-named role column.
- Impact: additive migrations + one rename + pipeline extension; the app must read
  `title` instead of `license_type`.

## Capabilities

### New Capabilities
- `tcole-source-import`: config-driven TCOLE source that reads the single 02-10
  workbook and emits LicensingAuthority/Agency/Personnel/Assignment/License/
  LicenseAction, keyed by TCOLE source keys, with the Assignment synthetic tuple
  matching the prior identity map's `id_field`.
- `canonical-id-preservation`: seeding the `SourceNameToCanonicalId` ledger from
  external source-key→canonical-ID maps so reconstruction preserves existing IDs.
- `license-import`: the licensing authority + license + license-action entities,
  the Assignment role/license model fix (rename + `license_id`), and their additive
  registration in the import pipeline.

### Modified Capabilities
<!-- None. The import-registry / SourceNameToCanonicalId extension for the fifth
kind is not a promoted base spec yet, so it is specified as part of the new
`license-action-import` capability rather than as a delta. -->


## Impact

- **New code**: `sources/gov.tx.tcole/config.ts`; a ledger-seed tool; Supabase
  migrations (`licensing_authority`, `license`, `license_action` tables; rename
  `agency_officers.license_type`→`title` + add `license_id`); `LicensingAuthority`/
  `License`/`LicenseAction` specs + generated schemas.
- **Modified code**: `src/shared/io/import-types.ts` (registry gains 3 kinds),
  `src/cli/state/source-name-to-canonical-id/index.ts` (3 new entity blocks),
  `src/cli/import/artifacts/transform.ts` + `plan-database-mutations.ts` (new rows
  + Assignment `license_id`/License `issued_by_authority_id` resolution).
- **Reused unchanged**: Census geocoder + address→location_path resolution +
  ResolvedProperty cache (`agency-*-resolution.ts`, `agency-coordinate-*.ts`).
- **Inputs**: one TCOLE workbook (`PublicInformationRequest_2025-02-10_1410.xlsx`), read-only. The 02-04 interim export is excluded.
- **DB**: additive migrations + one column rename; generated-types refresh; no data
  reset. **App contract**: consumers of `agency_officers.license_type` must switch to `title`.
