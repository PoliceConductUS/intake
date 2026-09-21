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
