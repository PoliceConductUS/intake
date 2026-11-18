## Why

Sources leave rows out without telling anyone. A drift check of every source on 2026-11-17 found transforms and acquires that drop a row with a bare `continue`, with only a count in the log, or by overwriting a record that has the same key. These records are evidence about real officers: a row that is missing and unreported is a gap nobody knows about. The owner's rule is that no phase of a source may skip anything silently.

## What Changes

- **A row a source cannot build into a record is reported, not dropped.** The record is not emitted. The transform reports one finding on the licensing authority the row's data belongs to. The finding holds what was left out, why, the source namespace, the source record ID and evidence that points at the row.
- **A record that is built with something corrected or left off is reported on that record.** The record is emitted and carries the finding.
- **Each finding becomes an annotation with a stable ID,** and is marked resolved by intake when a later `data generate` no longer reports it. This is the `record-findings` capability; no second mechanism is added.
- **A condition that cannot happen in good data stops the command.** Examples: an agency with a blank name or an unmapped state in an acquire, a blank ID column in the TCOLE workbook, a setting such as a minimum year that is not a number, an input path that cannot be read, and two rows that produce the same record key with different content.
- **A row that is read but is not ours to import is counted.** A docket, case or video that names no officer the database knows is left out by the existing selection rule. The transform logs the count for each such reason; it writes no annotation.
- **Every row is accounted for.** A transform states how many rows it read, emitted, reported and did not select. The shared transform step fails when the numbers do not add up, so a new silent skip fails the command.

## Capabilities

### New Capabilities

- `source-left-out-records`: What a source does with a row it does not turn into a record, in every phase.

### Modified Capabilities

- `oregon-dpsst`: A separation that follows a leave ends the employment on the separation date. A finding about an employment row is named by the officer and the row counted from the oldest event.

## Impact

Affected intake sources: every source with an acquire or a transform. The known cases are listed in `design.md`. Affected shared code: the transform step in `src/cli/transform`, which checks the row accounting, and `SourceManifest`, which carries it.

This change depends on the `record-findings` capability proposed in `move-complaint-summaries-to-generate`: its three "Findings (shared import)" tasks are done first. The CourtListener docket cases are already specified there and are not repeated here.

No Supabase migration and no generated type change. New annotations appear on licensing authority records and on imported records, so a `data generate` and `data up` are needed for each source after its change; no data reset. No downstream app contract changes: policeconduct.org shows annotations as intake writes them. The count of new annotations per source is reported before the change is merged.
