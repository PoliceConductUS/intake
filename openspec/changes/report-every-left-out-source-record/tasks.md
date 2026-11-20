## Depends on

- [x] The three "Findings (shared import)" tasks of `move-complaint-summaries-to-generate` (the `record-findings` capability).

## Shared

- [x] Add `accounting` to `SourceManifest` and the check in the shared transform step, with tests for a balanced count, an unbalanced count, and a row that feeds several records.
- [x] Add a test in `test/architecture.test.ts` that every source with a transform states its accounting.

## Sources

For each source: confirm the cases in `design.md` against the code, add any the drift check missed, write a failing test per case with an expected value that does not come from the code under test, then change the code.

- [x] `gov/texas/tcole`
- [ ] `com/site/my/mnitservices/post-license-search` (blocked: the owner rejected the source's design on 2026-11-19; see the design-proposal task below)
- [x] `net/bpl-orsnapshot/www/public-inquiry-cj`
- [x] `net/clearinghouse/api`
- [x] `com/courtlistener/www/api` (acquire and input checks only; the docket cases are in `move-complaint-summaries-to-generate`)
- [x] `com/youtube/policeactivity`
- [x] `org/policeconduct/submissions`
- [x] `org/psvproject/arrest-tracker`
- [x] `org/wikipedia/en/us-federal-law-enforcement-agencies`
- [x] `gov/census/www2/gazetteer`
- [x] `gov/irvingtx/arrests`
- [x] `org/policeconduct/manual` (counts each record it reads from its manual output)
- [x] `gov/az/post/roster` (reads no input; empty accounting)
- [ ] `com/site/my/mnitservices/post-license-search`: report `education-course-without-name` on the Minnesota authority, not on the officer's record (owner's ruling: a record a licensing source leaves out is annotated on that authority). Keep its code, type `warning`, field `name`, evidence `[{ file, courseId }]`, the course ID as source record ID, and one finding per course. Message: "A completed training course of officer <contactId> was left out because the state's record gives no course name." Remove `personnelFindings`; emit every `Personnel` record with `metadata: { defects: [] }`, so the annotations already written on officers are resolved. Update `sources/com/site/my/mnitservices/post-license-search/README.md` and the test in `test/sources/mn-post.test.ts`.

## Shared code

- [x] Confirm each `src/` case in `design.md` decision 7 against the code. For each one that drops a row, a file or an error without a report, write a failing test and make it fail loudly; list the others with the reason they stay (decision 7 records each outcome).
- [ ] `src/cli/transform/index.ts:sourceInputPaths(inputDir, logger)`: a required `logger: { info(message: string): void }`; log `<inputDir>: left out dotfile <path>` for each dotfile it leaves out. A dotfile is not a row of any input, so the log line is its outcome. `src/cli/data/source-pipeline.ts:transformOneSource` passes the command's logger; `beginCompletion` in `src/cli/transform/index.ts`, which lists the same folder again to check the transform's paths against the acquired snapshot, passes a logger that discards, so each dotfile is logged once. Log each left-out dot-folder once, with its full path, as `acquire-from-local.ts` does. `src/cli/state/transform-completion.ts:directoryDigest` also leaves dotfiles out; it stays as it is, because a dotfile is not part of the input. Change the calls in `test/sources/mn-post.test.ts` and `test/cli/transform/source-input-paths.test.ts`, update `src/cli/transform/README.md`, and test that one dotfile gives one log line.
- [ ] `src/cli/acquire/acquire-from-local.ts`: throw on an entry that is neither file nor folder, in a folder or a glob match, as `sourceInputPaths` does, and let a `stat` error other than a missing path propagate; test in `test/cli/acquire/acquire-from-local.test.ts`.

## Agency file names

- [x] Name each agency's output file, and the YouTube cache entry, by the agency's source ID in the acquires of `com/courtlistener/www/api`, `com/youtube/policeactivity` and `net/clearinghouse/api`, with a test of two agencies that share a name.
- [x] Move the existing YouTube cache entries to the agency's source ID with a one-time script on a clone of the dev workspace (no migration code in intake; `intake-workspace/migration-2026-11-17/migrate.mts`). 224 of 225 entries moved, one left out because its agency could not be told apart; no acquired file renamed; the digests in `transform-completion.json` are unchanged.

## Owner decisions

- [ ] `com/courtlistener/www/api`: emit a case once, from the lowest docket ID, when several dockets have one court and docket number; count the others under `another docket of the same case`, with no annotation. Test with the six dockets of txsd 4:22-cr-00560 (owner's ruling, 2026-11-19).
- [ ] `com/courtlistener/www/api`: never copy the title into `claims_summary`; use the CourtListener cause when present, otherwise the AI complaint summary, otherwise leave it empty with an annotation saying neither was available. Test each case. The AI complaint summary is produced in `data generate` (`move-complaint-summaries-to-generate`), so that change supplies the claims text (owner's ruling, 2026-11-19).
- [ ] `com/site/my/mnitservices/post-license-search`: count an identical repeated roster row as `repeated row`; throw, naming both rows, on two roster rows with one key and different content. Replace the test that holds the replacement (owner's ruling, 2026-11-19).
- [ ] Sources that report on state authorities: emit an authority the run did not fully cover with no `defects` key (an agency whose search failed or was skipped; an Oregon acquire of some name prefixes). Test both (owner's ruling, 2026-11-19).
- [ ] `org/policeconduct/manual`: a licensing authority record for every state an agency is in (DC, Virginia, Illinois and any other), created through the manual source; it is applied before the sources that report on state authorities (owner's ruling, 2026-11-19, from `move-complaint-summaries-to-generate`).
- [ ] Investigate CourtListener criminal cases, then write a proposal if the rules need to change. Criminal cases are kept, and an officer who is the defendant must attach to that officer. Find why the search returned txsd 4:22-cr-00560 (United States v. Martinez) for agencies that are not parties (`alamo-colleges-district`, `bandera-co-const-pct-3`, `bexar-co-const-pct-1`), and how a docket is linked to an officer; check those rules against criminal cases (an officer as defendant; a common name that matches the wrong person).
- [ ] Write a design proposal for the MN POST source (the acquire keeps the raw files; the transform joins them and reads existing records from the database) before further MN work. It removes the `?? []` fallbacks on a missing file or list in `transform.ts` (`inventory?.people`, `detail.licenses?.POSTLicenseList`). Blocks the MN tasks of this change (owner's ruling, 2026-11-19).
- [ ] `com/site/my/mnitservices/post-license-search`: emit an agency with no row in the agency workbook with the state `MN` and a `warning` annotation that MN POST gives no address for it; test (owner's ruling, 2026-11-19).
- [ ] `com/site/my/mnitservices/post-license-search`: give every left-out or incomplete row finding the type `warning` (it uses `error` for most today); test (owner's ruling, 2026-11-19: every such annotation is a `warning`).
- [ ] `com/site/my/mnitservices/post-license-search`: import every officer's past jobs from the agency-history workbook when the officer and the agency resolve, not only officers in the disciplinary-actions workbook (`acquire/discipline-workbooks.ts:parseHistoryRows`); test (owner's ruling, 2026-11-19).
- [ ] `org/psvproject/arrest-tracker`: read a total row (rows 351 and 353 of the workbook of 2026-10-15) and count it as not selected under `total row`, with no record and no annotation; test. Blocks validation of this change (owner's ruling, 2026-11-19).
- [ ] `net/clearinghouse/api`: keep a dotted acronym as one distinctive word ("L.C.R.A." becomes `lcra`); remove the count `agency name has no distinctive word`; throw, naming the agency, on a name that still has none; test (owner's ruling, 2026-11-19).
- [ ] `com/youtube/policeactivity` and `net/clearinghouse/api` acquires: catch only failed calls; a failed or skipped call fails the acquire at its end, naming each; any other error (a response of the wrong shape, a refused page URL, a failed log write, a search that reaches 500 videos) stops the acquire at once; tests (owner's ruling, 2026-11-19).
- [ ] One shared helper adds a record by key, keeps an identical repeat (counted as `repeated row`) and throws on the same key with different content, naming both rows; the sources use it in place of their own checks (owner, 2026-11-19).
- [ ] Run order: apply an authority `org/policeconduct/manual` creates before the sources that update it, and stop treating a kind a source only updates as a kind it produces; test with `planSourceOrder` (owner, 2026-11-19).
- [ ] Shared accounting check: fail on a missing `notSelected`, a blank reason, two entries with one input name, and an empty list from a source that reads inputs; fail when an input path is claimed by no input the source states; tests (owner, 2026-11-19).
- [ ] Write an ADR for the two exceptions to `AGENTS.md`: the YouTube cache re-keyed by a one-time script, and the Oregon annotation ID that moves when DPSST removes an older row (owner, 2026-11-19).
- [ ] Follow-up changes, one per capability, with spec deltas for the behavior commit `7275ec3` changed outside this capability (design "Open questions" before 2026-11-19; decision 7) (owner, 2026-11-19).
- [ ] `com/courtlistener/www/api`: search every agency already in the database; a state with no court list is not a reason to skip one; test (owner's ruling, 2026-11-19).
- [ ] `net/bpl-orsnapshot/www/public-inquiry-cj`: skip a scheduled hire and its future Required certificate row, as the accepted spec says, and count them under `scheduled hire`; the transform reads the validation day; test (owner's ruling, 2026-11-19).
- [ ] `src/cli/transform/employment.ts`: when a separation after a leave cannot be matched to one AgencyPersonnel on leave, keep each of them emitted ending on its leave date and put the finding on the separation row only; test (owner's ruling, 2026-11-19).
- [ ] `src/cli/requests/responses.ts:syncMessages`: keep a reply not addressed to the receiving address out of the request and name it in the sync report; test (owner's ruling, 2026-11-19).
- [ ] Follow-up proposal: a way to find those messages later, and a records-request report extending `requests status` (completed or not, how long pending, how long until the response data was received) (owner, 2026-11-19).
- [ ] `org/psvproject/arrest-tracker`: a row's identity is its article link, not its workbook row number; test that a row added above keeps the earlier IDs (owner's ruling, 2026-11-19).
- [ ] `org/psvproject/arrest-tracker`: count a row that holds only a link (rows 357 on in the workbook of 2026-10-15) under `row with only a link`; then look at what those links are and report before deciding whether to import them (owner's ruling, 2026-11-19).
- [ ] `org/policeconduct/submissions`: stop the transform, naming the submission, on an approved submission whose officer cannot be resolved or whose incident location cannot be placed; remove the agency-address fallback; tests (owner's ruling, 2026-11-19).
- [ ] `src/cli/transform/employment.ts`: attach a change of rank while the officer is on leave, with no employment at the agency open, to the employment the leave paused, with no annotation; test (owner's ruling, 2026-11-19).
- [ ] `com/youtube/policeactivity`: when one video is in two agency files with different content, keep the copy from the latest acquire and count the older under `older copy of a video`; fail loudly on loading a cache entry keyed by a name slug; tests (owner's ruling, 2026-11-19).
- [ ] `com/courtlistener/www/api`: take a case's place from the location of its court, not from the agency's state, so a docket found for agencies in two states builds one identical case; test (owner's ruling, 2026-11-19).
- [ ] Amend ADR 0030 to remove the agency-address fallback for a submission's location (owner's ruling, 2026-11-19).
- [ ] Each source's README lists the conditions that make it throw. Evaluate generating that list from the code, for example a test that compares the README list with the conditions the source throws on, and report the result (owner's ruling, 2026-11-19).
- [ ] Apply the owner's rulings on the other open questions; a ruling on behavior of another capability goes to a change of its own, with its spec delta.

## Validate

- [ ] Do not run `data up` on production until the website change that links the licensing authority page to the paged data-annotations page is deployed (owner's ruling; website repository).
- [ ] Run `npm run validate`, including OpenSpec validation. Loaded data changes, so run the Supabase validation (`npm run lint:sql`) and a reset that applies every migration.
- [ ] Run `data transform`, `data generate` and `data up` for each changed source on the dev workspace. Report rows read, emitted, reported and not selected, and new annotations by source and code. Assert each new annotation's subject record exists, and that each licensing authority selector a source emits matches exactly one record.
- [ ] Report what the Oregon `data generate` changes in `AgencyPersonnel`: the end dates of the employments whose separation follows a leave (737 in the dev workspace), the titles a separation's rank changes, and the separation rows reported because they match more than one employment on leave. Assert that no other field changes and that every record referring to a changed `AgencyPersonnel` still resolves.
