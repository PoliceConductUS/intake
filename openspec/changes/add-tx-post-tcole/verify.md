# Verify — add-tx-post-tcole

## Current verification — 2026-09-29

The real-data verification is complete against the local `dev-copy` workspace
and PostgreSQL at `127.0.0.1:54322`. The database already contained the successful
reconstruction in applied entry `000004-gov.tx.tcole`; this verification reran
the actual source transformation and comparison without resetting that database.

- `npm run cli -- data transform gov.tx.tcole`: passed using the preserved
  `PublicInformationRequest_2025-02-10_1410.xlsx` input.
- `npm run cli -- data generate gov.tx.tcole`: passed; **empty diff, nothing appended**.
- `npm run cli -- data verify`: all applied entries verify.
- All seven audited database tables are byte-equivalent under the same PostgreSQL
  value parsers before and after this run, including IDs, slugs, links, and timestamps.
- Fresh repository validation: **1,195 tests / 129 files passed**, type checking,
  build, and OpenSpec validation passed.

### Source and reconstructed counts

Counts below distinguish emitted candidates from **creates in the applied TCOLE
chain entry**. Other sources' existing rows are not counted as TCOLE creates.
Each listed create's canonical ID is present in the current database.

| Kind               | Fresh artifact records | Applied TCOLE creates | Missing creates |
| ------------------ | ---------------------: | --------------------: | --------------: |
| Agency             |                  3,739 |                 2,895 |               0 |
| Personnel          |                129,973 |               129,914 |               0 |
| AgencyPersonnel    |                170,622 |               170,366 |               0 |
| LicensingAuthority |                      1 |                     1 |               0 |
| AuthorityLicense   |                     12 |                    12 |               0 |
| License            |                153,021 |               152,962 |               0 |
| LicenseAction      |                188,115 |               188,003 |               0 |

The source also emits 6,826 AgencyPhoneNumbers. All artifact chunks were counted
and checked for duplicate source keys. The original six-kind checklist predates
the additional AuthorityLicense and AgencyPhoneNumber outputs.

### Canonical identity and role verification

All **276,622** entries in the preserved external identity maps were compared
with the durable ledger through canonical IO:

| Kind            | Historical mappings | Identical current mappings | Missing/reassigned mappings | Original IDs in database |
| --------------- | ------------------: | -------------------------: | --------------------------: | -----------------------: |
| Agency          |               2,950 |                      2,950 |                           0 |                    2,898 |
| Personnel       |             129,973 |                    129,973 |                           0 |                  129,914 |
| AgencyPersonnel |             143,699 |                    143,699 |                           0 |                  143,579 |

The established ledger was verified rather than overwritten by running the
one-time seed tool again. The counts include the previously documented five
personnel/assignment identity repairs. All 143,579 retained historical assignment
rows have the role title from their source tuple; zero title mismatches.

The absent IDs do not represent changed identity mappings:

- 52 agencies: documented exclusions in the prior per-record audit.
- 59 personnel: workbook and current ledger checks find 44 attached only to
  agencies outside the selected database and 15 attached only to invalid agency
  candidates reported by the current transform.
- 120 historical assignments: 113 attached to absent agencies and seven attached
  to the excluded DHS placeholder, as documented in the prior per-record audit.

### Licensing links

All 152,962 reconstructed licenses link to an existing person and AuthorityLicense,
whose LicensingAuthority is TCOLE at `/tx/`. All 170,366 reconstructed assignments
have a non-null existing license for the same person and valid agency/personnel
references. Zero missing links and zero wrong-person links were found. Global
license-action-to-license and AuthorityLicense-to-authority checks also found
zero orphans.

The current model is `License.authority_license_id` →
`AuthorityLicense.licensing_authority_id` → TCOLE. References below to the earlier
`issued_by_authority_id` schema and curated-authority proposal are historical;
this verification does not reintroduce them.

### Evidence

Audit directory:
`/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev-copy/audits/tcole-reconstruction-20260929/`.

- `report.json`: source provenance, all legacy-map counts, chain creates and
  presence checks, current artifact counts, and scoped license-link checks.
- `linkage.json`: authority jurisdiction, license-type counts, and global orphan checks.
- `assignment-roles.json`, `personnel-absent-workbook.json`, and the `*-absent.json`
  files: role and absence reconciliation.
- `database-before.json` and `database-unchanged.json`: unchanged-row verification.
- Preserved CLI/test logs and executable audit scripts accompany the results.

Workbook SHA-256: `46f9d380b16919f9f7a46c939d2468cab00f003e4ef78332c4f1ff8231610774` (16,983,932 bytes).

## Historical implementation record

The following dated entries document earlier states. Their pending/not-started
labels are superseded by the current verification above.

_Reconstructed 2026-08-13 from committed history (`6a370b5`…`d636958`, all
2026-08-12) after a lost session. Only claims backed by committed code or
passing tests are marked verified; real-data run captures that were never
recorded are listed as **PENDING** rather than estimated._

## Status summary

| Area                                                                   | State                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------- |
| Phase A — source config + emission (1.0–1.3, 1.5–1.6)                  | ✅ committed + unit-tested                           |
| Phase A — `license_type`→`title` rename + `license_id` (1.4)           | ❌ not started (legacy migration went the wrong way) |
| Phase A — ledger seed tool + round-trip (2.1–2.2)                      | ✅ committed + unit-tested                           |
| Phase A — real-data seed + employment run capture (2.3, 3.1–3.3, 3b.1) | ⏳ PENDING (no run recorded)                         |
| Phase B — licensing model (4.x, 5.x)                                   | ❌ not started                                       |

## Verified by passing tests (2026-08-13 local run)

- `test/sources/gov.tx.tcole.test.ts` — **passing**. Confirms:
  - Personnel keyed by `PUBLIC_GUID`; Agency keyed by `DEPARTMENT_NUMBER`
    (no slug / location_path_id / lat / lng emitted).
  - AgencyPersonnel keyed by the synthetic tuple
    `PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE`,
    matching the abandoned identity map's `id_field`.
  - The role is carried in `license_type` (=`APPOINTMENT`), **not** `LICENSE`.
  - Determinism: same input → identical records.
  - Referential integrity: Assignments referencing an un-emitted agency or
    officer are skipped (config guard).
- `test/shared/io/excluded-records.test.ts` — **passing**. Fail-loud storage of
  explicitly excluded records (per `intake-fail-loud-and-storage`).
- `test/cli/state/seed-from-identity-maps.test.ts` — **passing**. Ledger seed
  round-trips: `persistSourceNameToCanonicalIds` → `loadSourceNameToCanonicalIds`
  returns identical agency / personnel / agencyPersonnel canonical IDs.

## Committed implementation (provenance)

- `6a370b5` — TX POST source config + `readXlsx` sheet selection.
- `43691b2` — ledger-seed tool (`scripts/seed-tcole-ledger.ts`) for canonical ID
  preservation.
- `e3bd36d` — TIGERweb locality-centroid geocode fallback for un-geocodable
  agency addresses.
- `2259dd5` — county `location_path` fallback + tolerant skip of unresolvable
  agencies.
- `d64e260` — per-record artifact storage for Agencies / Personnel /
  AgencyPersonnel.
- `7a6d9e4` — explicit exclusion list (`sources/gov.tx.tcole/excluded.yaml`) +
  fail-loud on unresolvable records (was: 143 errors aborting the whole import).
- `8f22bb4` — import active agencies only + cascade to attached personnel.
- `4835cd8` / `1a4bd11` — existing agencies write as updates; slug contract
  enforced + test updated for the slug-invariant message.
- `d636958` — exclusion list trimmed to the 3 active non-agencies.

## Known divergence — task 1.4 (blocking Phase B)

The `agency_officers` role column is currently named **`license_type`**. A
legacy migration `20260626000000_rename_agency_officers_title_to_license_type.sql`
renamed `title`→`license_type` — the **wrong direction** for this design. Task
1.4 must add a migration renaming it back (`license_type`→`title`, idempotent,
keep NOT NULL), add a nullable `license_id`, refresh generated types, and update
`AgencyPersonnelSpec`. Until then the source config writes the role to
`license_type` (see the inline note in `sources/gov.tx.tcole/config.ts`).

## 2026-08-13 — task 1.4 (rename + license_id) landed

- Migration `20260627000000_rename_agency_officers_license_type_to_title.sql`:
  idempotent `license_type`→`title` rename (preserves rows/ids, keeps NOT NULL)
  - nullable `license_id` column (no FK yet — added with the `license` table in
    Phase B).
- `AgencyPersonnelSpec` field renamed `license_type`→`title`; generated envelope
  types + mutation envelopes regenerated (`npm run generate:envelope-types`).
  Hand-written references updated: `transform.ts` (`AgencyOfficerRow.title`,
  source column list, builder), `io/ArtifactMutation.ts` set-path enum.
- **Blank-`APPOINTMENT` decision (empirically settled).** The abandoned
  `agency-officers.yaml` map has **zero** keys with an empty `APPOINTMENT`
  segment (`grep` of the `guid|dept||…` pattern → 0), so seed dropped every
  blank-role row and none has a canonical id to preserve. Config now **retains**
  such rows with `title="Unknown"` (new additive rows, fresh cuids). The
  `"Unknown"` fallback is the column value only — the identity key keeps the raw
  (empty) `APPOINTMENT` segment, so existing rows stay byte-identical to the map.
- Verified: `npm run typecheck` clean; `test/sources/gov.tx.tcole.test.ts`
  (incl. new `"Unknown"` + empty-key-segment test), `import-transform`,
  `artifacts-command`, `plan-database-mutations`, `database-mutation-envelopes`
  all pass (100 tests). `seed-display.test.ts` fails at load on a missing
  `supabase/seed.sql` symlink — pre-existing/environmental, unrelated.

## 2026-08-13 — task 3b.1 (additive-load prerequisite) confirmed

Read `plan-database-mutations.ts` + `classify-database-operations.ts`. A run
applies as **additive create/read/update only**; it never deletes entities
absent from the run:

- `classifyDatabaseOperations` iterates solely over `rows.*` (rows present in the
  run) and assigns `"create"` / `"read"` / `"update"`. `"delete"` is never
  assigned anywhere in `src/cli/import`.
- Planning runs inside a transaction that is always **rolled back**; writes are
  plain `INSERT` with no `ON CONFLICT`/upsert (re-imports are idempotent by
  canonical id — asserted by the existing no-upsert test).
- The only deletions are same-run referential cascades
  (`dropExcludedAgencyDependents` drops in-memory rows referencing an excluded
  agency), not DB reconciliation.

→ 3b.2 is moot; Phase B (additive new kinds) is safe to proceed.

## 2026-08-13 — Phase B (licensing model) implemented

Three new import kinds — LicensingAuthority, License, LicenseAction — plus the
`agency_officers.license_id` link, wired end to end mirroring AgencyPersonnel.

- **Schema** `20260627000100_add_licensing_tables.sql`: the three tables + FKs
  (license→officers/licensing_authority, license_action→license,
  agency_officers.license_id→license).
- **Registry/specs/generated**: `import-type-metadata` (kinds + `dependsOn`),
  three Zod specs (+CreateSpecs), `license_id` on `AgencyPersonnelSpec`,
  `import-types`/`Artifacts`/`index` barrels, `schema.SupportedTableName`,
  `execute.ts` mutation metadata, and generated mutation envelopes.
- **Ledger**: three entity blocks in `source-name-to-canonical-id/index.ts`
  (+`seed-from-identity-maps.ts`).
- **Transform** resolves every FK by source key via the ledger, throwing on
  unmapped: LicensingAuthority `location_path_id` as a `/state/` **path string**
  through `mappings.locationPaths` (mirrors LocationPath parent resolution);
  License `officer_id`→personnel and `issued_by_authority_id`→licensingAuthorities;
  LicenseAction `license_id`→licenses; Assignment `license_id`→licenses
  (**null-safe** — null when blank or when the referenced license was not
  emitted, so no dangling refs). Fresh cuids minted for the new entities.
- **Op plumbing**: `operations`/`classify`/`plan-database-mutations`/
  `data-context` extended per kind (additive create/read/update only, per 3b.1).
- **Config** reads the `OfficersLicensesActions` sheet and emits all six kinds in
  dependency order (LicensingAuthorities, Agencies, Personnel, Licenses,
  LicenseActions, AgencyPersonnel). License = distinct `PUBLIC_GUID`×`LICENSE`
  (issued_by `tcole`, `first_awarded` = earliest action date); LicenseAction per
  `OfficersLicensesActions` row for emitted officers.
- **Curated authorities** `sources/gov.tx.tcole/licensing-authorities.ts`: a
  **verified subset** (TCOLE + AZ/CA/MN POST), not padded with unverified rows —
  full ~55-row IADLEST normalization is a flagged data task (5.0).

Verified 2026-08-13: `npm run typecheck` clean; `npx openspec validate
add-tx-post-tcole` valid; full `vitest` run **301 tests / 36 files pass**
(`seed-display.test.ts` still fails only on the missing `supabase/seed.sql`
symlink — environmental).

**Design decision — optionality.** The three new `ImportRows` arrays / their
`ownedColumns` sub-keys / the three `SourceNameToCanonicalIds` sections are typed
**optional** (mirroring the existing `locationPathGeometries` precedent) so the
many existing row/mapping literals keep compiling via `?? []`/`?? {}`; runtime
`load`/`transform` always populate them.

## 2026-08-14 — namespace isolation applied (ADR 0015); location resolution fixed

Design clarification captured in **ADR 0015** (isolated, mutually-ignorant
namespaces; self-contained sources; cross-source identity unified only at the
root; a source emits a namespace-local location value that the root maps). ADRs
0006/0008 got additive forward-pointers (no reverts).

Consequences applied to the licensing work:

- **No curated authorities list.** `sources/gov.tx.tcole/licensing-authorities.ts`
  deleted. `gov.tx.tcole` emits exactly one authority, TCOLE, in-source. DB
  authorities become {TCOLE, AZ POST, MN POST}, one per POST source; unifying a
  duplicate authority across sources is deferred root-level dedup (ADR 0008).
- **`location_path_id` resolution fixed.** The authority emits the namespace-local
  state value `"tx"`. The prior Phase B code resolved it through the (empty)
  `gov.tx.tcole` namespace ledger — a latent bug that would throw on a real run.
  It now resolves at the intake root: a new pre-transform stage
  `resolveLicensingAuthorityLocationsStage` calls
  `DataContext.locationPaths.getByPath("/tx/")` (the same resolver agencies use)
  and surfaces the canonical id via `resolvedProperties.licensingAuthorities`;
  the transform reads that and throws if unresolved (resolve-or-fail, ADR 0006).
  No ledger lookup for cross-cutting location.
- `License.issued_by` / `LicenseAction` / `AgencyPersonnel.license_id` unchanged —
  they resolve within `gov.tx.tcole`'s own namespace, which is correct.

Verified 2026-08-14: `npm run typecheck` clean; full `vitest` **302 tests / 36
files pass** (`seed-display.test.ts` still environmental); `openspec validate
add-tx-post-tcole` valid. New source test asserts TCOLE keyed `tcole` with
`location_path_id: "tx"`; new transform test proves resolve-or-fail.

## PENDING — real-data captures (Phase A employment + Phase B licensing)

These require running against the real 02-10 workbook + abandoned maps in the
dev workspace; numbers were never recorded, so they must be re-run, not guessed:

- **2.3** Seed the ledger from the real maps; record actual counts
  (design estimate: ~2,950 agencies / ~129,968 personnel / ~143,694
  agency-officers — confirm on run).
- **3.1** Confirm `intake run gov.tx.tcole` composes end to end.
- **3.2** Dry-run; reconcile Agency/Personnel/Assignment counts against the
  abandoned manifest; spot-check preserved canonical IDs.
- **3.3** Record the employment reconstruction result here.
- **5.3** Full single run emits all six kinds; confirm counts (incl. ~189k
  license actions), that `/tx/` resolves from the LocationPath ledger (census
  gazetteer must be imported), and that assignment `license_id` +
  license `issued_by_authority_id` resolve.
- **5.4** Record the full reconstruction result (counts, preserved IDs, license
  linkage) here.

(3b.1 is done — see the additive-load confirmation above.)
