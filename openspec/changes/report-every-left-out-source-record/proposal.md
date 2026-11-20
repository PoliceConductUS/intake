## Why

Sources leave rows out without telling anyone. A drift check of every source on 2026-11-17 found transforms and acquires that drop a row with a bare `continue`, with only a count in the log, or by overwriting a record that has the same key. These records are evidence about real officers: a row that is missing and unreported is a gap nobody knows about. The owner's rule is that no phase of a source may skip anything silently.

## What Changes

- **A row a source cannot build into a record is reported, not dropped.** The record is not emitted. The transform reports one finding on the licensing authority the row's data belongs to. The finding holds what was left out, why, the source namespace, the source record ID and evidence that points at the row.
- **A record that is built with a value replaced or left off is reported on that record.** The record is emitted and carries the finding.
- **Each finding becomes an annotation with a stable ID,** and `data generate` marks it resolved when a later run of the source no longer reports it. This is the `record-findings` capability; no second mechanism is added.
- **A condition that cannot happen in good data stops the command.** Examples: in an acquire, an agency with a blank name or an unmapped state; a blank ID column in the TCOLE workbook, a setting such as a minimum year that is blank or not a whole number, an input path that cannot be read, and two rows that produce the same record key with different content, unless the source's real data has shown the condition.
- **A row that is read but is not selected is counted.** A docket, case or video that names no officer the database knows, a row outside the source's stated scope, and a row that adds no fact an emitted record lacks (for example a second separation) are left out by the source's selection rule. The transform logs the count for each such reason; it writes no annotation.
- **Every row is accounted for.** A transform states how many rows it read, emitted, reported and did not select. The shared transform step fails when the numbers do not add up, so a row that is counted as read and given no outcome fails the command.
- **An acquire keeps each agency's results apart.** The CourtListener, YouTube and Clearinghouse acquires name each agency's output file, and YouTube its cache entry, by the agency's source ID, not by the slug of its name.
- **BREAKING (data meaning): an Oregon separation that follows a leave ends the employment on the separation date** (owner's ruling, 2026-11-17: a separation after a leave is a real separation). Before, the separation was skipped and the employment ended on the leave date. This changes what an Oregon `AgencyPersonnel` end date means for 737 employments in the dev workspace, and the expected end date of the accepted "Transfer during leave" scenario moves from 2017-01-17 to 2017-08-21. The separation's rank, when it gives one, becomes the title, so some of those titles change too.
- **Defects found in the same pass are fixed.** `design.md` decision 7 lists them with their outcomes. Some change behavior that is not a left-out case and belongs to another capability; `design.md` "Open questions" lists each one, and whether each needs its own spec delta is the owner's choice.

## Capabilities

### New Capabilities

- `source-left-out-records`: What a source does with each row it reads: the four outcomes, findings on a licensing authority or on an emitted record, the row accounting each transform states, and naming each agency's acquire file by the agency's source ID. It covers every transform and the acquire conditions `design.md` lists.

### Modified Capabilities

- `oregon-dpsst`: A separation that follows a leave ends the employment on the separation date. A finding about an employment row is named by the officer and the row counted from the oldest event. Left-out agencies, employments and rows get findings or counts instead of log lines, and an unmapped employment action at an agency the transform builds stops the transform.

## Impact

Affected intake sources: every source with an acquire or a transform. The known cases are listed in `design.md` decisions 6 and 7. Affected shared code:

- `src/cli/transform/accounting.ts` and the transform step in `src/cli/transform/index.ts`, which check and log the row accounting, and `SourceManifest` in `src/cli/transform/source-transform.ts`, which carries it;
- `src/cli/transform/employment.ts`, the root employment reconstruction, which gives every employment row an outcome and ends an employment on leave at a later separation;
- `sources/lib/state-authority-findings.ts`, which builds the licensing authority records of a source that reports on state authorities;
- `test/architecture.test.ts`, which checks that every source transform states its accounting;
- the `src/` cases of decision 7.

This change depends on the `record-findings` capability proposed in `move-complaint-summaries-to-generate`: its three "Findings (shared import)" tasks are done first. The CourtListener docket cases are already specified there and are not repeated here.

No Supabase migration, no generated type change and no production migration plan: production receives the data through `data generate` and `data up` like any other change. Loaded data changes: new annotations appear on licensing authority records and on imported records, and 737 Oregon `AgencyPersonnel` end dates move from the leave date to the separation date. A `data generate` and `data up` are needed for each source after its change; no data reset. No column or type of a downstream app contract changes: policeconduct.org shows annotations as intake writes them. The meaning of an Oregon `agency_personnel.end_date` changes for the 737 employments above; policeconduct.org shows the value as it is stored. An employment a separation after a leave makes ambiguous stays emitted, ending on its leave date, with the finding on the separation row only (owner's ruling, 2026-11-19). policeconduct.org lists a licensing authority's annotations on its page, without paging; the owner has ruled that the page links to the paged data-annotations page instead, which is a change to the website repository. The count of new annotations per source is reported before the change is merged.

No migration code is added to intake. The one-time workspace script of 2026-11-17 re-keyed the YouTube cache to agency source IDs; no acquired file was renamed (design decision 6).

The owner rejected the design of the Minnesota POST source on 2026-11-19 (the acquire joins its workbooks; the transform reads saved pages instead of the database); its rows in this change wait for a design proposal for that source. Known blockers before validation: the PSV transform throws on the two total rows of the current workbook until it counts them under `total row` (owner's ruling, 2026-11-19), and `data generate` fails for a source that reports on a state with no licensing authority record until `org/policeconduct/manual` creates one for every state an agency is in (owner's ruling, 2026-11-19).
