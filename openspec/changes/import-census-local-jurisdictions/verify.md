# Verification

Worktree: `redesign-config-driven-intake`. No new branch or worktree.

## Automated checks

- Full suite, including real PostGIS integration tests: `npx vitest run --maxWorkers=2` — **98 files, 641 tests passed**.
- `npm run typecheck` and `npm run build` — passed.
- `npm run openspec:validate` — 12 items passed.
- Scoped Prettier, SQLFluff for the additive migration, and `git diff --check` — passed.
- Regression tests first failed for missing COUSUB discovery and city/township precedence, then passed with implementation. Supplemental tests cover Alba, statistical classes, missing county, full coverage by multiple PLACE polygons, clipping, unknown classification and consolidated government.
- Actual PostGIS tests cover migration application, primary default and constraints, city/township shared-edge selection, uncovered township selection, consolidated-city selection, and no-match failure. Existing mutation replay integration tests pass.
- The first unconstrained full test run exceeded an existing ten-second database startup timeout; running with two workers passed. A concurrent regression-development run observed the intended new malformed-source test failures; the final complete run passed all 641.
- Independent read-only review found no blocking issues. Its documentation clarification about Z2 local jurisdictions was incorporated.

## Operational scope

The additive migration and source changes are committed for the redesign workflow. The user's current database, existing source workspace, identity ledger, and immutable mutations are untouched by verification. Tests use disposable databases. New Census files were downloaded only to `/private/tmp/census-local-jurisdictions` for the nationwide audit.

To load the expanded data, apply the additive migration, acquire the complete Census source set (COUSUB plus CONCITY for the same vintage), and run the existing Census produce/import workflow. Existing primary location rows retain the database default `primary`; generated envelope IO applies the same default to existing mutation records. New supplemental records explicitly carry their resolution class.

The namespace logs the coverage report path and writes `local-jurisdictions-<year>.json` in its persistent state directory. Original TIGER files are retained; township site geometry is their polygon minus imported PLACE coverage. No aliases are invented for whole townships covered by several places.

## Nationwide Census 2025 audit

See [summary](national-audit.json) and [complete 35,496-row coverage audit](national-coverage.csv).

- Read 32,058 PLACE features, 35,488 county subdivisions and all 8 consolidated cities.
- Reconstructed 35,249 existing paths using the saved source vintage and hierarchy; every original path and descriptive row remained byte-for-byte equivalent at the source-record level. The durable ID mapping ledger was never written.
- Added 24,728 paths: 12,121 subdivisions without PLACE overlap, 12,599 clipped subdivisions, and 8 consolidated cities.
- Skipped 5,135 subdivisions fully covered by the union of imported PLACE polygons.
- Excluded 5,633 statistical, unorganized or undefined subdivision records under the approved class policy.
- No unknown Census class or path/alias collision occurred.
- Alba township (2706300604) emits `/mn/jackson-county/alba-township/` under the source's Jackson County, with its Census polygon (no clipping needed).

## Result

PASS for the namespace implementation and the approved containment behavior. The new places are verified transform output, **not yet loaded into the user's existing development database**. That requires applying the migration and running Census acquisition/produce/import as described above.
