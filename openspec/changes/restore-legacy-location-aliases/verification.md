# Verification

Validated on 2026-09-21 in `redesign-config-driven-intake` against the local
`dev-copy` workspace. No production database was changed.

## Applied data

- Added exactly the twenty records in [aliases.json](aliases.json) through the
  existing `org.policeconduct.manual` source validation and persisted history.
- Generated and inspected entry
  `data/mutations/000009-org.policeconduct.manual.DatabaseMutations.yaml`:
  exactly twenty `LocationPathAliasCreate` operations, all pointing to the
  reviewed canonical IDs. Applied that one pending entry.
- Alias count increased from 1,456 to 1,476. Every old alias and every column of
  all 35,249 canonical location rows was unchanged.
- All twenty aliases resolve to their reviewed target IDs and paths.
- All nine data-chain checksums pass verification.
- Manual curation evidence is retained under workspace
  `command/2026-09-21T05-33-48-932Z-dvvmpjrhdhmgbjxxobxnfv5a/org.policeconduct.manual/output/`.
  Persisted manual state is under `state/org.policeconduct.manual/manual/`.
  These workspace files are outside Git; the reviewed batch and audit are
  checked in here. Rebuilding this local database from its saved data chain
  retains the aliases.

## Fresh database replay

Created a temporary PostGIS database using the repository's
`startIntakeDatabase` helper, applied current migrations, and replayed all nine
existing data-chain entries with `applyPending`. All entries succeeded.
Verified all twenty aliases against both target ID and path, all chain
checksums, 35,249 canonical locations, and 1,476 aliases. Removed the temporary
database after verification. This exercised migration and data-chain replay;
it was not a Supabase seed reset.

## Review coverage

[review-104.csv](review-104.csv) has exactly one row for each original audit
record: twenty added aliases, nineteen existing aliases, and sixty-five
individual unresolved dispositions. Every listed candidate ID/path exists in
the current database. All 104 retired location IDs remain absent; this change
restores path resolution only.

[census-evidence.json](census-evidence.json) records the saved Census source
checksums and the Medina/Ivanhoe records checked in response to the user's
question. The current Census places are correct; that does not establish that
the linked agencies belong to those places.

## Checks

- Manual-source tests: 2 files, 8 tests passed.
- Full fresh-database replay: 9 entries passed.
- OpenSpec validation: 10 items passed, 0 failed.
- Scoped formatting and whitespace checks passed.
- All 104 legacy rows checked against saved Census inputs; all 35,249 current
  paths matched the reconstructed tree. Raw TIGER county intersections for
  96 relevant places in nine states matched the saved hierarchy.
- No application code, migrations, or seed data changed; a compilation build
  is not needed for this curated-data and audit change.

## Agency point checks

Read-only point-in-shape queries covered all 123 current agencies linked to the
104 audit rows. Forty-six assigned place shapes do not contain the stored point.
Sam Rayburn ISD resolves spatially to Fannin County; the two Medina agencies have
stored points inside Zapata County. These are documented defects, not repaired
by the spelling-alias batch.
