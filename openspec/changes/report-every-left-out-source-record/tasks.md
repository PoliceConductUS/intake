## Depends on

- [ ] The three "Findings (shared import)" tasks of `move-complaint-summaries-to-generate` (the `record-findings` capability).

## Shared

- [ ] Add `accounting` to `SourceManifest` and the check in the shared transform step, with tests for a balanced count, an unbalanced count, and a row that feeds several records.
- [ ] Add a test in `test/architecture.test.ts` that every source with a transform states its accounting.

## Sources

For each source: confirm the cases in `design.md` against the code, add any the drift check missed, write a failing test per case with an expected value that does not come from the code under test, then change the code.

- [ ] `gov/texas/tcole`
- [ ] `com/site/my/mnitservices/post-license-search`
- [ ] `net/bpl-orsnapshot/www/public-inquiry-cj`
- [ ] `net/clearinghouse/api`
- [x] `com/courtlistener/www/api` (acquire and input checks only; the docket cases are in `move-complaint-summaries-to-generate`)
- [ ] `com/youtube/policeactivity`
- [ ] `org/policeconduct/submissions`
- [ ] `org/psvproject/arrest-tracker`
- [ ] `org/wikipedia/en/us-federal-law-enforcement-agencies`
- [ ] `gov/census/www2/gazetteer`
- [ ] `gov/irvingtx/arrests`

## Shared code

- [ ] Confirm each `src/` case in `design.md` decision 7 against the code. For each one that drops a row, a file or an error without a report, write a failing test and make it fail loudly; list the others with the reason they stay.

## Agency file names

- [ ] Name each agency's cache entry and output file by the agency's source ID in the acquires of `com/courtlistener/www/api`, `com/youtube/policeactivity` and `net/clearinghouse/api`, with a test of two agencies that share a name.
- [ ] Add the state migration that renames the existing files and cache entries in a workspace, and run it on the dev workspace; assert the number of files and entries is unchanged and none is overwritten.

## Validate

- [ ] Run `npm run validate`, including OpenSpec validation. No Supabase migration changes, so no Supabase validation applies.
- [ ] Run `data transform` and `data generate` for each changed source on the dev workspace. Report rows read, emitted, reported and not selected, and new annotations by source and code. Assert each new annotation's subject record exists.
