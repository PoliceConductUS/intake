# Verification and applied recovery

Applied on `redesign-config-driven-intake` to the local database at
`127.0.0.1:54322` and workspace `intake-workspace/dev-copy`.

## Root cause and code

The original `abandoned/data-requests/scripts/map-tcole-seed-identities.py`
reader returned raw XML `1` for boolean name cells. Added a real XLSX regression
covering both a boolean first name and last name, observed its failure, and fixed
boolean decoding. The regression now passes. `legacy-reader.patch` records the
external script correction alongside this branch's recovery record. The test
also remains beside that script as `test_map_tcole_seed_identities.py`.

The current intake reader already handles these cells. Added a real ExcelJS
workbook regression; the reader and TCOLE source suites pass (20 tests).

## Restored identities

`identities.json` records the five confirmed source identifiers, original and
retired personnel IDs, original URLs, and original and retired employment IDs.
Evidence is the retained production reference plus exact name, agency, role,
and start-date matches documented in the original personnel identity audit.

- Ten forward mappings now point to original IDs; ten corresponding reverse
  mappings were written through canonical IO.
- Five original published slugs are stored under their original canonical IDs.
  The five obsolete slug-cache entries were retired.
- The historical personnel and employment identity maps gained exactly five
  missing entries each, so a fresh workspace seed also retains these identities.
- A rehearsed transaction restored the five personnel rows and five employment
  IDs. All five license IDs and other row contents were preserved. No downstream
  employment-reference rows existed for these five records.

## Replay and database verification

The previous immutable mutation directory is retained intact in the evidence
folder. A corrected reconstruction lineage changes exactly 15 creates: five
Personnel IDs/slugs, five AgencyPersonnel IDs/personnel references, and five
License personnel references. Only entry `000002` changes; its metadata records
its original checksum. The corrected lineage was replayed through all eight
entries in an isolated database provisioned from the actual current migrations.
All original IDs/URLs were present, all ten retired IDs absent, and entity counts
matched the local database. All replay checksums verified.

The local database adopted that verified lineage with the equivalent scoped
transaction; the existing local database was not reset. The applied ledger's
entry `000002` checksum was changed from the verified original checksum to the
verified corrected checksum in the same transaction. Original lineage and
checksum evidence remain inspectable; no applied original files were edited.

An independent database connection compared fingerprints across all 36 public
application tables. All contents and row counts matched after accounting only
for the approved ten ID substitutions, five slug substitutions, and timestamps.
The original IDs and slugs, preserved license IDs, and restored employment IDs
were independently checked again after commit.

No new acquisition, schema change, production deployment, or additional identity
merges occurred. Location paths and the other unresolved personnel candidates
were unchanged.

Evidence: `/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev-copy/audits/tcole-true-repair-20260921/`.

Validation: focused tests (20 passed), legacy Python regression (passed),
TypeScript build (passed), OpenSpec validation (9 passed), full eight-entry
fresh-database replay (passed), and 36-table before/after comparison (passed).
