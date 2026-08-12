# TX POST (TCOLE) Reconstruction — Design

**Status:** Approved decisions captured; ready for implementation planning.
**Branch:** `redesign-config-driven-intake` (all config-driven intake work consolidated here).
**Date:** 2026-08-12

## Goal

Add TX POST (TCOLE) as a config-driven intake source so intake reconstructs the
existing TX rows of the production database from external TCOLE files —
preserving existing canonical IDs — and, beyond seed, ingests the richer
license-action history. TX is ~86% of the DB's agencies, so this is the
highest-leverage step toward retiring `seed.sql`.

## Source data

Two TCOLE Public-Information-Act workbooks (user confirmed the 02-10 file "is
missing a lot of data"; each file has data the other lacks):

| File | Contents | Notes |
| --- | --- | --- |
| **SMALL** `PublicInformationRequest_2025-02-10_1410.xlsx` (16.9 MB) | `Departments` 3,906 (**with addresses**), `Officers` 129,973, `Services` 170,754, `OfficersLicensesActions` 189,629 | What `seed.sql` was built from (via `data.policeconduct.org/TX/config.py`). Base for Agency/Personnel/AgencyPersonnel. |
| **BIG** `PublicInformationRequestDepartmentData_02.04.25.xlsx` (38 MB) | `Sheet1` 608k rows (`1.person` 129,126 / `2.service` 168,478 / **`3.license` 310,970**); `Active Depts.` 2,954 (no addresses) | Supplies the richer **LicenseAction** set (310,970 vs 189,629). |

Overlap (measured): officers share 129,122 `PUBLIC_GUID`s; only 4 unique to BIG,
851 unique to SMALL, 26 name conflicts, no garbage names. So the merge is clean:
**SMALL is the base for the three existing kinds; BIG supplies LicenseAction (+ the 4 stray officers).**

Canonical file locations recorded in the plan; both are read read-only from
outside the repo (acquisition is a separate concern — these are treated as the
already-acquired inputs, like the gazetteer's cached TIGER files).

## Architecture

A config-driven source (`sources/gov.tx.tcole/config.ts`, namespace
`gov.tx.tcole`) whose deterministic `run(deps)` returns a manifest of emitted
records. The existing `intake run` → `runImportArtifactsCommand` pipeline does
the rest. Nothing about acquisition, geocoding, or DB mutation is re-implemented.

### Field mappings (existing kinds)

**Agency** ← SMALL `Departments`, keyed `DEPARTMENT_NUMBER`:
- `name` ← `DEPARTMENT_NAME`; `state` ← `STATE`; `city` ← `CITY`
- `address` ← `ADD_LINE1` (+ `ADD_LINE2` when present); `zip_code` ← `ZIP_CODE`
- `contact_name` ← `HEAD_NAME`; `contact_email` ← `E_MAIL`
- `phones` ← `{ main: PHONE, fax: FAX }` (when present)
- **Not emitted:** `slug`, `location_path_id`, `latitude`, `longitude` — these
  are produced by the import pipeline's existing agency resolution (see below).

**Personnel** ← SMALL `Officers` (∪ 4 BIG-only), keyed `PUBLIC_GUID`:
- `first_name` ← `FNAME`; `last_name` ← `LNAME`; `middle_name` ← `MNAME`; `suffix` ← `SFX`

**AgencyPersonnel** ← SMALL `Services`, keyed by the synthetic tuple
`PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE`
(dates `YYYY-MM-DD`, empty segment when null — must match the abandoned map's key format exactly):
- `agency_id` ← `DEPARTMENT_NUMBER` (**source key**, resolved to canonical via the ledger by `transform.ts`)
- `personnel_id` ← `PUBLIC_GUID` (**source key**, resolved via the ledger)
- `start_date` ← `ST_DATE` (`YYYY-MM-DD`); `end_date` ← `END_DATE` or null
- `license_type` ← **`APPOINTMENT`** (the role — "Peace Officer", "Chief of
  Police"). The DB column `agency_officers.license_type` is the renamed `title`
  column (migration `20260626000000`), and seed's `config.py` set `title =
  APPOINTMENT`; it is NOT NULL. The `LICENSE` value is not stored on
  agency_officers (seed discarded it) — it flows to the LicenseAction kind
  instead. `APPOINTMENT` and `LICENSE` both remain in the identity key.

Referential integrity: every `DEPARTMENT_NUMBER`/`PUBLIC_GUID` referenced by a
Service must have an emitted + ledger-mapped Agency/Personnel, or `transform.ts`
throws "references unmapped …". The config must guarantee this.

### Location resolution — REUSE existing infrastructure (no new code)

The import pipeline already: geocodes agency addresses via the **US Census
Geocoder** (`agency-coordinate-resolver.ts` → `geocoding.geo.census.gov`
addressbatch, batch 1000; wired **by default** at `config.ts:724`), resolves
address → `location_path_id` (`agency-address-resolution.ts`), and caches results
as `ResolvedProperty` records keyed by an `inputFingerprint`
(`agency-field-resolution.ts` / `agency-coordinate-cache.ts`). MN POST agencies
already flow through this. TX agencies inherit it automatically by emitting raw
address fields. Point-in-polygon runs against the ported gazetteer geometries;
geocoding stays a cached, replayable resolution step outside deterministic `run()`.

### ID stability — seed the ledger from the prior mapping

Existing canonical IDs must be preserved. The abandoned prior attempt
(`PoliceConductUS/abandoned/data-requests/identity/sources/tcole/*.yaml`) already
maps every TCOLE source key to its `seed.sql` canonical ID:
- `agencies.yaml`: `DEPARTMENT_NUMBER → agency.id`
- `personnel.yaml`: `PUBLIC_GUID → officers.id`
- `agency-officers.yaml`: synthetic tuple → `agency_officers.id`

A one-time **ledger-seed step** transcribes these into the intake
`SourceNameToCanonicalId` ledger for namespace `gov.tx.tcole` via the existing
`persistSourceNameToCanonicalIds` (DRY — no hand-rolled YAML; correct encoding).
Because the ledger key = emitted record key (`sourceNameForImportRecord` is
identity) and the reader keys off `metadata.name`, a pre-seeded mapping is
**reused** by `resolveArtifactsSourceNameToCanonicalIds`; only genuinely-new
entities get a fresh `cuid2`. Result: existing entities keep their seed IDs;
new/changed entities are additive.

Validation note: the source file is newer than seed, so row counts exceed seed
(more current data). Success = existing IDs preserved + no unexpected losses,
**not** exact row-count parity with seed.

## LicenseAction — the one genuinely new build

The pipeline hard-codes four kinds (`LocationPath`, `Agency`, `Personnel`,
`AgencyPersonnel`) in `importTypeRegistry` and in the four-entity blocks of
`source-name-to-canonical-id/index.ts`. Adding **LicenseAction** (from BIG's
310,970 rows) requires, additively:
- a DB migration for a `license_action` table (columns: personnel FK, license,
  action, action date, award date, status, description — reconciling BIG's
  `SERVICE_LICENSE`/`LICENSE_TITLE`/`ACTION_DATE`/`ACTION_DESCRIPTION` shape);
- a `LicenseActionSpec` + generated record schema + registry entry;
- a fifth ledger entity type + the transform/plan-database-mutations plumbing;
- config emission from BIG keyed by a stable synthetic tuple; `personnel_id`
  carries `PUBLIC_GUID` (resolved via the ledger).

License-action rows are new to the DB → all fresh `cuid2` (no seed IDs to preserve).

## Two additive runs (input classification)

The source is exercised as **two separate `intake run gov.tx.tcole` invocations**
against the same namespace, **oldest-produced file first**, so the second
preserves and extends the first. What each run emits is forced by what each file
can produce (BIG has no addresses and no `APPOINTMENT`; SMALL is the only source
of both, and a strict superset of agencies):

- **Run 1 — BIG / 02-04 (produced 2025-02-04, oldest):** Personnel +
  LicenseAction. LicenseAction is person-scoped (no agency FK), so it needs only
  the Personnel emitted in the same run. Agencies and employment rows are NOT
  emitted here (BIG lacks addresses and roles).
- **Run 2 — SMALL / 02-10 (produced 2025-02-10, newer):** Agency + AgencyPersonnel
  (+ the superset Personnel). **Additive**: overlapping officers resolve to Run
  1's canonical IDs via the shared `gov.tx.tcole` ledger; new officers (851) and
  all agencies/employment are added. Because the pipeline's load is additive
  (disappearance = no-op), Run 1's Personnel and LicenseActions are untouched.

Data completeness: the 608 service tuples unique to BIG cannot become employment
rows (BIG has no `APPOINTMENT` for the NOT NULL role column), but those officers'
license activity is captured by Run 1's LicenseAction — so no license history is
lost, only 608 agency-employment-period rows for which TCOLE's older file never
recorded a role.

`run()` classifies its input paths (mirroring `census-gazetteer`'s `matchInputs`):
the 02-04 workbook (`Sheet1` with `rectype` + `Active Depts.`) triggers Personnel
+ LicenseAction; the 02-10 workbook (sheets `Departments`/`Officers`/`Services`)
triggers Agency + AgencyPersonnel + Personnel. One source module, two runs.

**Load-preservation assumption (must verify):** the import pipeline must treat a
run's artifacts as additive-upsert only — it must NOT delete entities absent from
the current run's artifacts. The two-run model depends on this. Verify against
`plan-database-mutations.ts` before Run 2; if the pipeline reconciles-by-deletion,
that is a blocker to resolve first.

## Phasing (build order ≠ run order)

**Build order** — sequenced by what reuses existing machinery:
- **Phase A**: the source config's SMALL branch (Agency + Personnel +
  AgencyPersonnel) + the ledger-seed tool, reusing the existing four kinds and the
  Census agency resolution. Independently reconstructs the bulk of the TX DB
  (agencies, personnel, employment with roles + preserved IDs), testable with a
  SMALL-only run. Highest value, no pipeline surgery.
- **Phase B**: the new LicenseAction kind (migration + registry + ledger entity +
  transform plumbing) and the source config's BIG branch (Personnel +
  LicenseAction).

**Run order** — the final reconstruction runs **oldest-produced first** so newer
data wins on conflict and license history is preserved: **BIG (02-04) then SMALL
(02-10)**. This requires both phases built, so it happens after Phase B. During
development Phase A is exercised SMALL-only; the ordered two-run reconstruction is
the Phase B acceptance test.

Each phase gets its own implementation plan.

## Non-goals / deferred

- Acquisition (how the xlsx files arrive) — separate system; files treated as inputs.
- No AgencyPersonnel are dropped. 02-10 supplies the bulk (170k, with
  `APPOINTMENT`, matching the seed identity key). Run 2 additively captures the
  **608** service tuples that exist only in 02-04 (measured; name→number linking
  is zero-risk — 0 of 2,862 names fail to match). Those 608 are net-new (not in
  seed) and carry an empty `APPOINTMENT` (02-04 has no such column), but the
  assignment — officer, agency, dates, license — is fully preserved.
- `data.policeconduct.org/TX/config.py` is a reference for how seed was built, not a porting target.
- Deleting `intake.census-gazetteer` / the abandoned data-requests tree (owner's call).

## Testing

- Source `run()`: deterministic + record-shape tests on small synthetic fixtures
  (mirroring `census-gazetteer/run.test.ts`), plus key-format tests asserting the
  AgencyPersonnel synthetic tuple exactly matches the abandoned map's `id_field`.
- Ledger-seed: round-trip test (YAML in → ledger files → `loadSourceNameToCanonicalIds` returns the same map).
- E2E: dry-run count reconciliation against the abandoned manifest (2,950 agencies mapped, 129,968 personnel, 143,694 agency-officers) + spot-check preserved IDs.
