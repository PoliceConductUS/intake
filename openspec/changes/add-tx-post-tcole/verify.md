# Verify — add-tx-post-tcole

_Reconstructed 2026-08-13 from committed history (`6a370b5`…`d636958`, all
2026-08-12) after a lost session. Only claims backed by committed code or
passing tests are marked verified; real-data run captures that were never
recorded are listed as **PENDING** rather than estimated._

## Status summary

| Area | State |
| --- | --- |
| Phase A — source config + emission (1.0–1.3, 1.5–1.6) | ✅ committed + unit-tested |
| Phase A — `license_type`→`title` rename + `license_id` (1.4) | ❌ not started (legacy migration went the wrong way) |
| Phase A — ledger seed tool + round-trip (2.1–2.2) | ✅ committed + unit-tested |
| Phase A — real-data seed + employment run capture (2.3, 3.1–3.3, 3b.1) | ⏳ PENDING (no run recorded) |
| Phase B — licensing model (4.x, 5.x) | ❌ not started |

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

## PENDING — real-data captures to redo before closing Phase A

These require running against the real 02-10 workbook + abandoned maps in the
dev workspace; numbers were never recorded, so they must be re-run, not guessed:

- **2.3** Seed the ledger from the real maps; record actual counts
  (design estimate: ~2,950 agencies / ~129,968 personnel / ~143,694
  agency-officers — confirm on run).
- **3.1** Confirm `intake run gov.tx.tcole` composes end to end.
- **3.2** Dry-run; reconcile Agency/Personnel/Assignment counts against the
  abandoned manifest; spot-check preserved canonical IDs.
- **3.3** Record the employment reconstruction result here.
- **3b.1** Read `plan-database-mutations.ts`; confirm a run applies as additive
  upserts only (absent entities NOT deleted) — a hard prerequisite for the
  Phase B two-run/additive strategy. Document the finding here before starting 4.x.
