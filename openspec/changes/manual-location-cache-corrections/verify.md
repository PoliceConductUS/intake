# Verification

## Development workspace changes

Applied the 29 records listed in `$INTAKE_WORKSPACE/audits/tcole-location-corrections-20260922/manual-locations.csv` to `/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev-copy` through `org.policeconduct.manual`. Checked each original canonical ID against the existing ledger, retained that ID in the manual source mapping, and recorded each place through the manual acquire command. No conflicting mappings or missing parents were found.

Transformed the manual source, generated `000011-org.policeconduct.manual.DatabaseMutations.yaml` with 29 effective mutations, and applied it. The envelope also contains 28 existing-record reads. A read-only database check found all 29 places with the expected published IDs, paths, display names, and parent counties, and no geometry rows. No agency assignment was guessed or changed. Alba Township remains Census-owned and was not added manually.

## Code checks

- 38 tests passed across the cache CLI, canonical cache storage, geocode resolvers, reset orchestration, reset CLI registration, mutation chain, and general CLI.
- Two disposable-Postgres integration tests passed. They exercise the real Supabase schema reset, current migrations, real generation and application, manual geography before remaining sources, repeated reset with stable personnel IDs and slugs, and nonzero failure for an unresolved manual location reference.
- A cache CLI/DataContext test creates an agency mutation using the manual location override without invoking address/boundary resolution.
- Type checking and build passed.
- OpenSpec validation passed all 17 items.

The development database was not reset. Only the authorized 29 manual location creates were applied there. Reset tests targeted disposable Docker databases. No live agency cache overrides were set.

## Entries-only cache and command provenance

Replaced the separate override, overrideHistory, and legacy top-level value
representations with required `entries`. At most one entry is unfingerprinted;
that entry wins over matching automatic entries without modifying the file on
read. Replaced overrides keep their complete entry under unique
`previous-override-N` fingerprints. Automatic writes preserve the active override.

New `cache set` invocations create a canonical Command envelope through the
existing command-directory mechanism. The new entry records that command's ID,
its timestamp, and source identity. Replaced entries retain these fields. Original
command IDs were not recorded for older corrections and were not invented during
conversion.

Converted 148,249 supported workspace cache files using the previous canonical IO for reading and the new canonical IO
for writing. This included 466 CivilCase files with colon-containing canonical
IDs. Every new envelope was validated before application; each source-file digest
was checked before writing and every output was read back and compared against
the complete expected envelope. Values, source fingerprints, original timestamps,
metadata, and prior manual history were preserved. Agency 1903 remains assigned
to Tennessee Colony, and agency 1202 retains the Google coordinates.

The 1,185 files from the obsolete source-key cache layout are outside the current
canonical cache naming/identity contract and were not changed or adopted. Their
subject includes a source namespace and their filename includes the input hash;
they were already incompatible with the current reader before this change.

Six initial regression failures demonstrated the old representation, missing
unfingerprinted-override behavior, and old unkeyed selection behavior. Validation
passed 134 distinct tests across cache storage, CLI, slug ownership, facade
resolution, strict envelope IO, architecture, and PostgreSQL slug preservation.
The 10 PostgreSQL tests ran against a disposable database. Type checking, build,
and all 17 OpenSpec items passed. The user's database was not reset or regenerated.

A final read through canonical IO validated all 158,311 current-format workspace
cache files; exactly three active override entries retained known timestamps.

## CLI-only manual cache corrections

Removed the transform cache-population hook and its filesystem-copy adapter.
Deleted all ten checked-in TCOLE coordinate cache files and their provenance
document. Updated the operator guide, ADRs, source and generated-code comments,
and OpenSpec to make `cache set` the canonical manual correction path.

A regression first failed because a transform copied a checkout fixture into an
empty workspace cache (latitude became 33.4). After removal, the same transform
succeeds and the cache remains empty. Existing cache and CLI correction tests
continue to pass: 92 focused tests across transform, canonical cache, CLI, facade,
DataContext, MN source and reset sequencing. Type checking, build, and all 17
OpenSpec items passed. No database reset, migration, or workspace-cache change
was performed for this removal.

## Cat Spring manual addition — 2026-09-22

Added Cat Spring under Colorado County at the user's request. The county's
[constable directory](https://www.co.colorado.tx.us/page/colorado.constable)
confirms 1053 Constable Lane, Cat Spring, TX 78933; the supplied agency point
falls within the imported Colorado County boundary. The
[community website](https://catspringtexas.com/moving-here/) describes the
Cat Spring area as spanning Austin and Colorado counties.

Recorded the place through `data acquire org.policeconduct.manual`, transformed
and generated the manual source, then applied
`000003-org.policeconduct.manual.DatabaseMutations.yaml` to the local development
database. Generation reported one effective mutation; the envelope also includes
57 existing-record reads. Verified the resulting place has ID
`k49oqsixfl80fct8m2qb9ctr`, path `/tx/colorado-county/cat-spring/`, display name
`Cat Spring`, parent `/tx/colorado-county/`, and no boundary. The database is at
the data-chain head. The durable manual source retains the record for rebuilds.
No agency cache assignment was changed.
