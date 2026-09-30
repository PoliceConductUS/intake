# Verification

## Reproduction

- Three focused facade regressions failed separately: changed LocationPath, LocationPathAlias, and ReviewPersonnel rows each returned the corresponding empty Read instead of an Update. Result before removal: 3 failures, 37 passes.
- After removal, the real CLI regression exposed `LocationPathUpdate is malformed at spec.operations.3.from.` Generic database reads returned binary PostGIS values instead of canonical GeoJSON for existing centroid/bbox fields. The failure was reproduced before changing spatial reads.
- The next real CLI failure was `ReviewPersonnelUpdate is malformed at spec.operations.1.from.` PostgreSQL numeric values were strings while canonical rating fields require numbers.
- The streamed geometry regression changed an existing boundary and received `empty diff, nothing appended`; it expected 3 chain entries and received 2. The separate existence-only geometry read was reproduced before changing its planner.

## Results

The disposable CLI regression creates support records through canonical artifacts and `data generate`/`data up`, then edits the three affected kinds through manual acquire/transform/generate/up. No live database or source state is used as a test fixture.

The three-entity CLI regression verifies updates, stable identities and paths, absent-field preservation, precise spatial round trips, mixed-kind reads, unchanged no-op, and stale replay rejection. The streamed geometry regression verifies object-form creates/updates, serialized-form equivalence, stable identity, precision, unchanged no-op, and stale replay rejection. Explicit Read envelopes still replay successfully.

- Final focused command: `npm test -- test/cli/data/entity-updates.integration.test.ts test/cli/data/geometry-updates.integration.test.ts test/cli/data/report-update.integration.test.ts test/import/entity-facade.test.ts test/import/artifacts/data-context.test.ts test/import/artifacts/same-run-identity-convergence.test.ts test/import/artifacts/current-row-reader.test.ts test/import/replay-database-mutations.integration.test.ts test/import/manual-location-path.integration.test.ts test/import/manual-location-path-alias.integration.test.ts test/cli/transform/emit-sink.test.ts test/cli/transform/emit-integration.test.ts`.
- Result: 121 tests passed across 12 files.
- Standalone typecheck, scoped formatting, and `git diff --check` passed.
- OpenSpec validation: 26 items passed.
- Runtime search found no remaining read-only upsert option or automatic geometry Read emission.
- Independent review confirmed the read-only removal, spatial/numeric adapters, and streamed geometry changes, including preservation of the existing object/string payload contract. No remaining findings in this change's scope.

No live database or source data was changed. Tests used disposable PostgreSQL and canonical CLI workflows. No reset, migration, dependency change, commit, or deployment was performed.

## Separate follow-up

Review of the combined working-tree diff identified an edge case in the earlier timestamp change: inputs with more than six fractional digits are retained by timestamp comparison, while PostgreSQL stores microseconds. Those inputs can produce repeated updates after database rounding. This is separate from read-only source suppression; no precision rule was added in this change.

Resolved by the subsequent user-requested whole-second timestamp contract and refined by the user's truncation choice; see [fractional truncation](../2026-09-27-fix-report-update-generation/verify.md#fractional-truncation). Fractions are discarded before timestamp parsing or database writes, preventing database rounding into the next second; raw source values remain inspectable.

## Completion verification — September 26, 2026

- Full suite: `npm test -- --hookTimeout=180000` passed all 836 tests across 115 files, with no skips.
- The initial default-timeout run passed 825 tests but timed out the unchanged float-precision suite's database startup at 10 seconds; teardown then reported `Cannot read properties of undefined (reading 'stop')`. That suite passed unchanged in isolation. The final full run used a longer hook timeout without changing repository test configuration.
- `npm run lint` (including typecheck) and `npm run build` passed after the final calendar-date correction.
- Independent combined-diff review found the calendar-date regression documented in the report change; correction and re-review completed. No other concrete correctness findings remained.
- No production database, live source, migration, or seed changes were made during completion. Database integration tests used disposable databases.

Archive completed at `openspec/changes/archive/2026-09-27-remove-read-only-upserts/` (the archive CLI uses UTC dates). The delta requirements are synchronized to the durable specs.

Post-archive `npm run openspec:validate`: 26 items passed, 0 failed. Scoped formatting and `git diff --check` passed.
