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

**LicenseAction kind (new)**
- From: the import pipeline supports exactly four kinds; no license-action table.
- To: a fifth kind + `license_action` table + spec/registry/transform plumbing,
  fed from the 02-04 file's 310k rows.
- Reason: capture the fuller-than-seed license history.
- Impact: additive DB migration + pipeline extension; non-breaking.

## Capabilities

### New Capabilities
- `tcole-source-import`: config-driven TCOLE source emitting Agency/Personnel/
  AgencyPersonnel keyed by TCOLE source keys, with the AgencyPersonnel synthetic
  tuple matching the prior identity map's `id_field`.
- `canonical-id-preservation`: seeding the `SourceNameToCanonicalId` ledger from
  external source-key→canonical-ID maps so reconstruction preserves existing IDs.
- `license-action-import`: a new import kind + `license_action` table + pipeline
  plumbing for TCOLE license-action history.

### Modified Capabilities
<!-- None. The import-registry / SourceNameToCanonicalId extension for the fifth
kind is not a promoted base spec yet, so it is specified as part of the new
`license-action-import` capability rather than as a delta. -->


## Impact

- **New code**: `sources/gov.tx.tcole/config.ts`; a ledger-seed tool; a Supabase
  migration for `license_action`; `LicenseActionSpec` + generated schema.
- **Modified code**: `src/shared/io/import-types.ts` (registry), `src/cli/state/
  source-name-to-canonical-id/index.ts` (fifth entity), `src/cli/import/artifacts/
  transform.ts` + `plan-database-mutations.ts` (LicenseAction rows).
- **Reused unchanged**: Census geocoder + address→location_path resolution +
  ResolvedProperty cache (`agency-*-resolution.ts`, `agency-coordinate-*.ts`).
- **Inputs**: two TCOLE workbooks (02-10 base, 02-04 license actions), read-only.
- **DB**: additive migration; requires a generated-types refresh; no data reset.
