# Verification

## Development workspace changes

Applied the 29 records listed in [manual-locations.csv](manual-locations.csv) to `/Users/dalelotts/dev/PoliceConductUS/intake-workspace/dev-copy` through `org.policeconduct.manual`. Checked each original canonical ID against the existing ledger, retained that ID in the manual source mapping, and recorded each place through the manual acquire command. No conflicting mappings or missing parents were found.

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

Converted 148,249 supported workspace cache files plus all 10 checked-in TCOLE
cache seeds using the previous canonical IO for reading and the new canonical IO
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
