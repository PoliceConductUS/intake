# Irving import verification

## Outcome

The complete import (000014, 323 mutations) and exact-source-text correction (000015, 259 updates) are applied. Independent original-workbook-to-database reconciliation passed all 1,007 checks, including charge distributions, monthly counts, joint-cell reconciliation, officer coverage and the missing-charge finding. All applied chain entries verify. Repeating transform and generate returned an empty diff; no further mutations were appended.

The target is the configured local development PostgreSQL database at 127.0.0.1:54322, using the dev-copy intake workspace. This does not publish the website or update production.

## Source reconciliation

Original workbook SHA256: `f1a85af8b6baf415c9385fd7ad8c37d85244c4abd7bb44e7b6d7714b13318272`.

| Measure | Count |
|---|---:|
| Original arrest rows | 41,757 |
| Distinct bookings | 41,211 |
| Original charge rows | 179,916 |
| Linked charge rows | 179,913 |
| Orphan charge rows | 3 |
| Distinct full linked charge tuples | 63,776 |
| Bookings with matching charge records | 31,764 |
| Bookings without matching charge records | 9,447 |
| Original offense rows | 61,795 |
| Linked offense rows | 61,792 |
| Orphan offense rows | 3 |
| Officer profiles | 322 |
| Bookings without a resolved officer | 6,917 |
| Bookings assigned an arrest beat | 28,744 |
| Bookings assigned residential-area income | 29,154 |

All bookings remain in agency totals. The agency data-quality finding explicitly reports 9,447 bookings without matching charge records; its reason is unknown. Missing links do not establish zero legal charges. All linked charge rows retain multiplicity; no primary charge is selected. Original workbook and orphan rows remain in private evidence.

Independent verification exposed trimming in the old shared spreadsheet reader. Charges and Offenses now preserve source strings verbatim. The earlier trimmed audit's 63,773 linked tuples and 63,776 source tuples are superseded by 63,776 linked tuples and 63,779 source tuples. The original unmodified workbook remains the authority.

## Geographic coverage and meaning

Beat assignment uses arrest-location evidence and official Irving patrol polygons. Residential addresses supply Census tract income only. Income means ACS 2020–2024 median household income in 2024 dollars for the residential tract, with margins of error and annotations retained. It is not individual income.

Arrest-beat coverage: 28,744 matched; 10,525 unreliable geocodes; 1,936 missing locations; 3 missing geocode evidence; 3 conflicting locations. Income coverage: 29,154 matched; 2,547 geocoder no match; 205 ties; 5,276 missing residential addresses; 3,917 nonstreet addresses; 65 unparseable addresses; 24 unavailable ACS income; 18 state mismatches; 5 conflicting residential addresses.

The preserved prior arrest-coordinate audit is derived evidence, accepted at its HIGH/MEDIUM quality levels. Official beat polygons do not provide historical effective dates. Coverage failures remain in totals and explicit status categories.

## Validation

- Full suite before the final serialization/raw-text corrections: 1,334 tests in 141 files passed.
- Final Irving source regression suite after those corrections: 29 tests in 4 files passed, including canonical multi-profile serialization and exact charge-text preservation.
- Type checking and build passed after the final code changes.
- Canonical IO/shared persistence validation and isolated PostGIS migration tests passed. The additive migration was applied to local development without resetting its data.
- OpenSpec validation: 40 passed.
- Independent scoped code review found no actionable defects; exact-text adapter also reviewed.

`npm run link-seed` is unavailable and no local seed.sql exists. A seeded database reset was not performed; migration validation used an isolated PostGIS database. Existing development data was preserved.

The independent verifier and final import/chain/rerun logs are retained in the private `dev-copy/audits/irving-complete-20261006/` workspace folder.

## Website handoff

See `sources/gov.irvingtx.arrests/README.md` for the persisted agency/officer contract and counting definitions. `agency_arrest_profile` supplies the complete agency summary independently of officer matching. Joint monthly beat/income cells support website filters. Public aggregates exclude arrestee names, addresses, booking identifiers and precise address coordinates. Population arrest rates require matching population denominators, which this change does not supply.

Work remains in the existing `codex/oregon-dpsst` worktree, uncommitted and unmerged. Unrelated Oregon additions are preserved.
