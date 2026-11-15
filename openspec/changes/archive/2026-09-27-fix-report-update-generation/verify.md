# Verification

## Reproduction

Before the implementation change, the disposable PostgreSQL regression created and applied a manual report, acquired changed prose, and ran transform/generate. Generation returned `data: org.policeconduct.manual — empty diff, nothing appended.` The test failed because it expected 3 data-chain entries and received 2.

## Fix

Removed only Review's `upsert: "read"` override and obsolete comment. The normal facade now emits field diffs and the existing mutation planner removes unchanged updates.

## Results

- `npm test -- test/cli/data/report-update.integration.test.ts test/import/entity-facade.test.ts test/import/mutation-plan.test.ts test/sources/org.policeconduct.manual/manual.test.ts`: 4 files, 45 tests passed.
- `npm run typecheck`: passed.
- Scoped Prettier and `git diff --check`: passed.
- `npm run openspec:validate`: 25 passed, 0 failed before final archival.
- Regression covers CLI acquire/transform/generate/up, generated title/description/desired_outcome changes, no database write before up, preserved ID/slug/location/coordinates, preservation of absent case_number, and an unchanged rerun with no new entry.

The initial skip regression used a disposable database provisioned through existing migrations. No seed/schema files changed, so a live seed reset was neither needed nor run.

Final independent code review: no correctness findings. Removed two stale descriptions of reports as immutable from the related relationship comment and ADR 0032. These final edits change prose only.

## Timestamp failure and requested title restoration

The real CLI title restoration subsequently failed with `ReviewUpdate is malformed at spec.operations.2.from.` Adding incident_date to the disposable regression reproduced the same failure. PostgreSQL returned a JavaScript Date where the envelope requires a string. Generation and replay now compare schema-identified timestamptz fields by instant, preserving fractional precision and source text.

- Timestamp and extended CLI regression: 2 files, 4 tests passed. Covers title-only edits with equivalent timestamp offsets, actual microsecond changes, unchanged regeneration, and stale replay rejection.
- Adjacent replay, current-row reader, mutation envelope, facade, mutation planner, and manual source tests: 6 files, 62 tests passed.
- Typecheck, scoped formatting, diff checks, and OpenSpec validation passed (25 OpenSpec items).
- Manual source title was restored through `data acquire` and `data transform`. `data generate` produced entry 000011 with exactly one set: Review cm79tsstp00000cjr25ujcmvp.title to `1st amendment retaliation arrest`. Remaining operations only check existing values.
- `data up --to 000011` applied the entry. `data verify` confirmed every applied entry. HTTP verification confirmed the restored h1 at the original localhost URL, unchanged disclaimer, and absent How reports work aside.

Second independent review found one unresolved issue: timestamp inputs without a timezone use the Node host timezone during comparison but PostgreSQL uses its session timezone. The user's explicit UTC report is unaffected. No timezone-policy change was authorized. The user objected to expanding the task into that decision, so neither a new validation contract nor a UTC-default rule was added. This concern remains documented; no claim of clean final review or release readiness is made.

After applying the title restoration, a further `data generate org.policeconduct.manual` returned `empty diff, nothing appended`, confirming that the unchanged live source does not produce repeated date updates. Timestamp values are ordinary incident data, not freshness markers controlling whether source artifacts are generated.

## Explicit timezone requirement

The user subsequently selected requiring an explicit timezone. A shared timestamp schema now requires `Z` or a numeric UTC offset in generated timestamptz field validation and before comparison. It leaves date-only SQL fields and raw submission evidence unchanged. Source records, artifacts, creates, update from/to values, and checks reject timezone-less timestamps.

- Before implementation, the new regressions produced 7 failures and 10 passes: all six canonical boundaries and the comparison function accepted timezone-less values.
- `npm test -- test/shared/timestamp-io.test.ts test/shared/timestamp-value.test.ts test/cli/data/report-update.integration.test.ts test/sources/org.policeconduct.manual/manual.test.ts test/sources/org.policeconduct.submissions/transform.test.ts`: 5 files, 27 tests passed.
- Typecheck, scoped Prettier, and `git diff --check` passed.
- `npm run openspec:validate`: 25 items passed.
- `npm run cli -- data verify`: all applied entries verify under the new validation.
- Independent review found no additional issues and confirmed the previously documented timezone mismatch is resolved. No timezone default, source-date rewriting, database migration, or live data mutation was added for this requirement.

## Subsequent review finding

The remove-read-only-upserts review later identified timestamp inputs with more than six fractional digits as a separate edge case: comparison retains those digits while PostgreSQL rounds to microseconds, potentially producing repeated updates. No precision behavior was changed as part of that subsequent task. The explicit-timezone rejection remains verified.

## Whole-second resolution

The user subsequently specified that report timestamps need no more than one-second resolution. Shared validation now rejects nonzero fractional seconds and accepts whole-second representations with zero-only fractions. Comparison no longer reconstructs fractional digits. Explicit timezones remain required; date-only fields and managed audit timestamps are unchanged.

- Red: seven new failures showed that canonical record/artifact/create/update boundaries and comparison accepted nonzero fractions.
- Green: `npm test -- test/shared/timestamp-io.test.ts test/shared/timestamp-value.test.ts test/cli/data/report-update.integration.test.ts test/sources/org.policeconduct.manual/manual.test.ts test/sources/org.policeconduct.submissions/transform.test.ts`: 33 tests passed across 5 files.
- The CLI regression applies a one-second timestamp edit, verifies unchanged regeneration, and rejects stale replay. Zero fractions, numeric offsets, PostgreSQL timestamp strings, and JavaScript whole-second Date values compare consistently.
- Typecheck, scoped Prettier, diff checks, and OpenSpec validation passed (26 OpenSpec items).
- No database migration or live-data change was made. The previous over-six-digit precision mismatch is excluded by the new input contract; no rounding or truncation was introduced.
- `npm run cli -- data verify`: all applied entries verify under the whole-second contract. Independent review found no remaining issues in this change.

## Fractional truncation

The user then requested truncating nonzero fractions instead of rejecting them. Zoned fractional input is accepted and retained in raw source records. The shared timestamp helper removes fractional digits before parsing, and both generated mutations and replay create/update writes use the resulting whole-second value. Comparisons use the same resolution. This supersedes fractional rejection above.

- Red: 10 failures and 15 passes showed that fractional input was still rejected at canonical boundaries, during CLI acquisition, and during comparison.
- Green: 73 tests passed across 7 suites: timestamp IO/value, report CLI, entity CLI, geometry CLI, entity facade, and database-mutation replay integration.
- Tests cover `.9999999` without rollover, numeric offsets, pre-epoch values, fractional generated creates/updates, same-second edits producing no entry, direct canonical replay creates/updates, and raw manual-source preservation through `readLatest`.
- Typecheck passed. Independent review found no issues in truncation, write coverage, or preservation of raw source/date-only/audit fields.
- OpenSpec validation passed all 26 items. No database migration or live source/database write was made.

## Final review: calendar-date preservation

Independent review reproduced a regression: JavaScript Date normalized `2023-02-29T08:00:00Z` to March 1, whereas PostgreSQL rejects the original input. Timestamp normalization must not turn an invalid incident date into a different valid date.

- Added a calendar-date rejection scenario before implementation.
- Red: 9 failures and 25 passes across canonical timestamp boundaries and timestamp comparison.
- Green: all 34 tests passed after checking the date prefix with `z.iso.date()` in the shared timestamp schema. Valid leap days, explicit offsets, fraction truncation, and source text preservation remain covered.
- Independent re-review found the issue resolved, with no further findings.
- Open Code Review's claimed colonless-offset parsing failure was not reproduced on the project runtime: `+0530`, fractional `+0530`, `-0630`, and `+05` all produced the correct UTC whole-second values. No extra normalization was added.

## Completion verification — September 26, 2026

- Full suite: `npm test -- --hookTimeout=180000` passed all 836 tests across 115 files, with no skips.
- The initial default-timeout run passed 825 tests but timed out the unchanged float-precision suite's database startup at 10 seconds; teardown then reported `Cannot read properties of undefined (reading 'stop')`. That suite passed unchanged in isolation. The final full run used a longer hook timeout without changing repository test configuration.
- `npm run lint` (including typecheck) and `npm run build` passed after the final calendar-date correction.
- Independent combined-diff review found the calendar-date regression documented in the report change; correction and re-review completed. No other concrete correctness findings remained.
- No production database, live source, migration, or seed changes were made during completion. Database integration tests used disposable databases.

Archive completed at `openspec/changes/archive/2026-09-27-fix-report-update-generation/` (the archive CLI uses UTC dates). The delta requirements are synchronized to the durable specs.

Post-archive `npm run openspec:validate`: 26 items passed, 0 failed. Scoped formatting and `git diff --check` passed.
