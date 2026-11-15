# Oregon DPSST verification

Status: implementation checks PASS; live database import BLOCKED by unresolved
agency geography. The change remains open pending end-to-end import verification.

## Automated verification

- Full Vitest suite: 138 files, 1,301 tests passed.
- Focused source coverage: 33 tests across four files passed.
- Typecheck, build, formatting and OpenSpec validation passed (39 items).
- Independent source review found no remaining blockers after fixes for malformed
  empty tables, agency identity mismatches and incomplete pagination manifests.
- No dependencies, schema changes or shared pipeline exceptions were added.

## Live verification (2026-10-05 Pacific)

Acquired prefix Z through the public source: four search pages, 138 unique officer
IDs and 88 agency codes. This is bounded verification, not statewide coverage.

Transformation produced:

| Kind                 | Records |
| -------------------- | ------: |
| LicensingAuthorities |       1 |
| AuthorityLicenses    |      18 |
| Agencies             |      83 |
| Personnel            |     138 |
| AgencyPersonnel      |     179 |
| Licenses             |     290 |
| LicenseActions       |     290 |
| AgencyPhoneNumbers   |      83 |

Transformation logged 77 issue/omission messages (not 77 unique omitted records).
Raw HTML remains available for missing agencies, unsupported employment actions
and incomplete employment episodes. Two agency codes returned explicit no-data
responses; three further agency candidates did not pass validation.

Workspace: `/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev`.
Acquisition command: `2026-10-06T00-01-44-171Z-kyvl5bijhjgg048p23y07yn8`.
Transformation command: `2026-10-06T00-03-50-194Z-vtgez5si5bfehcchp5462ymo`.

## Import blocker

Generation first stopped on Coffee Creek Correctional Facility coordinates.
Facility coordinates from the official Census prison facility list were recorded
through the shared cache correction CLI, with evidence retained in
`audits/oregon-dpsst-20261005/coordinate-evidence.json` in the intake workspace.

The next generation attempt stopped on agency BNN, Deschutes County Adult Parole
& Probation, source address `63360 Britta St., Building 2, Bend, OR 97701`.
Its geocoded point (44.098905189198, -121.308576727677) is outside all loaded place
boundaries. A read-only PostGIS distance query placed it 6.38948173 metres outside
Bend. The official county page confirms the street address but does not resolve
this coordinate/boundary discrepancy. No city assignment was fabricated.

No database import was applied. `data status` reports `data: no entries` after
failed generation. Database write verification and unchanged-rerun verification
remain unproven. No existing local database reset was performed; the regression
suite uses a disposable database for its reset integration tests.

## Operational limits

Acquisition starts fresh each time; partial-download resume is not implemented.
Default A-Z acquisition has not been run end-to-end. Training and education are
outside this implementation. Existing license fields do not represent source
expiration/probation dates; those remain in raw evidence.

## Follow-up: user-authorized Bend correction

On 2026-10-05 Pacific, the user explicitly directed assigning BNN to Bend.
The shared cache CLI recorded `location_path_id=qemet8dyljzscaqkasnsac04`
(command `g7xbipc63ktdfgwulgrduj9l`). Generation passed BNN and then stopped at
SRI, DOC/Snake River Correctional Institution, 777 Stanton Boulevard, Ontario,
OR 97914. Its geocoded point (44.08252335131, -117.06995668072) falls outside
loaded place boundaries. No SRI place correction or database import was applied.

Full A-Z acquisition was started in command
`2026-10-06T05-09-25-309Z-b7vurnm1uufb0er0u9oprdvj`. It remains in progress;
its manifest, not the earlier Z sample, will establish full source counts.

## Statewide follow-up (2026-10-05 Pacific)

The full A-Z search completed with 706 pages, 34,593 affiliations, 22,082 distinct
people and 356 agency codes. 13,975 people have at least one Active affiliation;
this is not an active sworn-police count. Detail acquisition remains in progress.

Statewide evidence exposed underscore-containing agency codes and multi-row
agency responses. The parser now preserves those codes and selects the unique
exact affiliated agency name. Interrupted acquisitions reuse validated complete
units without discarding later checkpoints. Public Logout redirects trigger one
logged search-session renewal and one retry; all other failures remain visible.
Focused verification: 37 tests pass. Independent review found no remaining code
blockers after checkpoint preservation and duplicate-identity fixes.

The configured `dev` workspace did not match the existing database's nine-entry
history. No Oregon import was applied there. `dev-copy` verified all nine entries;
Oregon mappings and audited corrections were transferred there through canonical
ledger IO and the shared cache CLI. Existing DPSST authority identity
`m1aqzraw6pcvrkr1oquotna6` is reused. Future import targets `dev-copy` explicitly.

Official-source research supplied 82 address-field corrections for 71 agencies.
Exact 911 address-point and USGS police-facility coordinates resolve additional
geocoder failures. Evidence and transfer audit are retained under the target
workspace's `audits/oregon-dpsst-20261005/` directory.

Kilkich was verified from tribal publications, created using the manual source,
and applied as entry 000010 with one LocationPathCreate mutation. The ten-entry
chain verifies. Its canonical ID is `tl3ts8nz02lbkqht5lo6dxou`; CXP is explicitly
assigned to that community. Rural facilities without qualifying place containment
remain unresolved pending explicit assignment decisions. No postal/nearest-city
substitution was applied to those records.

The user subsequently authorized explicit nearby assignments within 10 kilometres
(2026-10-05 Pacific). Eight corrections were applied through the shared cache CLI
and read back through canonical PropertyCorrection IO with place-level database
validation: DRC to Madras (2,538 m), SRI to Ontario (7,050 m), BNS to Bend (32 m),
WCF to Lakeview (4,056 m), TMS to Tillamook (2,901 m), CIF to Hood River (6 m),
KTP to Chiloquin (50 m), and CTT to Florence (188 m). These distances are from
agency address points to loaded place boundaries. Coordinates were not moved.
The automatic containment resolver was not changed. The audit, CLI results and
read-back verification are in agency-preflight/distance-override-\*.json under the
existing Oregon workspace audit directory. SFI remains outside this allowance;
its current address point is approximately 25 km from Tillamook's boundary.

With these assignments, the existing Z batch generated and applied entry 000011:
883 mutations comprising 49 AgencyCreate, 116 PersonnelCreate, 18
AuthorityLicenseCreate, 256 LicenseCreate, 138 AgencyPersonnelCreate, 256
LicenseActionCreate, 49 AgencyPhoneNumberCreate and one LicensingAuthorityUpdate.
The full applied chain verifies after this import. These are partial-batch counts,
not completion of statewide detail acquisition.

## Statewide reconciliation (2026-10-06 Pacific)

An independent audit supersedes the earlier roster totals above: all 706 saved
search pages contain 34,584 affiliations, 22,080 distinct people, 13,975 people
with an Active affiliation, and 353 agency codes. Every partition search page is
byte-identical to the original acquisition; there are no added/removed people or
agency IDs and no cross-partition officer overlap. The earlier 22,082/356 summary
was inaccurate, not evidence of records lost during partitioning. The compact
reconciliation audit is retained in the workspace's Oregon audit directory.

The user supplied South Fork Forest Camp's exact coordinates
45.58961731783809, -123.4639752978012. A current Census lookup and loaded boundaries
place it in unincorporated Tillamook County, with no qualifying containing place.
The user explicitly authorized Tillamook despite a 29,945 m boundary distance.
Coordinates and location assignment were cached through the shared CLI.

The completed C/L/T/V/W partition then generated and applied entry 000012 with
29,981 create mutations: 155 agencies, 4,380 personnel, 17 authority-license
categories, 9,420 licenses, 6,370 employment records, 9,484 license actions and
155 agency phone numbers. All applied entries verify. Statewide acquisition
continues; these counts do not represent statewide completion.

The user also approved Fossil PD's candidate physical address, 401 Main Street,
Fossil OR 97830, and the supplied official address point. The conditional address
correction preserves the source PO Box 467; coordinates are explicit corrections.

The user approved 2126 Warm Springs Street for WGN. Census geocoding and official
address-point/USGS searches returned no court point. OpenStreetMap way 751402301
explicitly identifies the Warm Springs Tribal Court building and tribal operator.
A point on the building polygon's surface (44.76314265, -121.266165574357) was
verified inside `/or/jefferson-county/warm-springs/` and cached. This is a building
point, not a community centroid. Raw geometry and derivation are retained in the
workspace audit. The official court page establishes the approved street address;
continued probation occupancy is the explicit user-accepted address decision.

## Full statewide import (2026-10-06 Pacific)

All four acquisition partitions completed. The merged input contains 22,080 unique
people, 353 agency codes, 706 search pages and 45,220 referenced raw evidence files.
All referenced files exist; the search pages match the original acquisition byte
for byte, with no cross-partition officer overlap or agency-response parse errors.
The complete raw dataset was staged through `data acquire --from-local` in
`dev-copy`, then transformed through the normal CLI.

Full transformed counts: 22,080 Personnel, 254 Agencies, 28,403 AgencyPersonnel,
46,322 Licenses, 46,637 LicenseActions, 40 AuthorityLicenses, 254 AgencyPhoneNumbers
and one LicensingAuthority. The source returns explicit No Data Found for 74
agency codes; 25 other agency responses lack required address/locality fields and
are retained with visible rejection evidence. Employment ambiguities and missing
source information produced 15,334 logged omissions/issues; this is an issue count,
not a count of distinct people. Raw evidence and full source Artifacts remain
inspectable.

Existing graph-selection rules omitted 16 agency candidates, 2,485 personnel,
41 employment records, 3,345 licenses, 3,366 license actions and 16 phone records.
These rules admit agencies through supported open employment or case links and
retain their connected records; no selection rules were weakened for this source.

Entry 000013 contains 103,858 create mutations and was inspected and applied.
Combined Oregon entries 000011–000013 were verified by ID against the live database:
238 agencies, 19,595 people, 40 authority-license categories, 42,977 licenses,
28,362 employment records, 43,271 license actions and 238 agency phone numbers.
All expected IDs exist. The complete applied data chain verifies, and there are
zero missing or non-place agency location references across the database.
The compact record-count audit is `statewide-database-verification.json` in the
workspace's `audits/oregon-dpsst-20261005/` directory.

The full statewide generation was repeated after applying entry 000013. It
compared supplied source fields with existing rows and produced zero mutations
(`empty diff, nothing appended`). Final focused source verification passed all
37 tests; OpenSpec validation passed all 39 items. The earlier full regression
suite passed 1,305 tests. No database reset, schema change, or shared selection-rule
change was performed for the statewide run.
