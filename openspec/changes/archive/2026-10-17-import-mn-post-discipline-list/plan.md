# Plan

Use TDD and subagent implementation/review required by the bridge. Work in this worktree only, preserve unrelated dirty main changes.

1. Acquisition: add workbook reader + tests for 571 source rows, numeric license keys, total row, grouped history license cells, duplicate/conflicting source rows. PostClient.searchLicense uses observed exact-license endpoint. Save `discipline-personnel.json` containing search rows and spreadsheet histories, and fresh `.detail.json` records. Test a revoked officer absent from rosters and wrong-license/name collision. Existing roster tests remain green.
2. Transform: read `discipline-personnel.json` before detail license validation. Reuse existing contactId personnel keys, emit actual discipline and additional licenses, and explicit former assignments from source history only when agency IDs resolve. Test standalone revoked person with no assignment, same-name distinct license holders, repeated existing contact, and correct history dates.
3. Verification: focused vitest, npm run validate, OpenSpec validation, independent review. Run official source collection and reconcile all 571 licenses. Preserve discrepancies and original workbooks.
4. Apply the generated mutation chain only after confirming the configured database history matches dev-copy; verify foreign keys and before/after counts. No database reset.

Review focus: same-name different-license people; current vs historical assignment duplication; boolean discipline flag versus actual action details; grouped workbook rows; importer traversal of unassigned personnel.

## Shared identity alias implementation

Before rekeying imported source actions, use TDD to add the shared `cache alias` command and command-output mapping provenance. Verify missing original mappings and conflicting new mappings fail, original IDs and forward mappings survive, new aliases become preferred reverse names, and replay preserves identity. Root execution will independently verify each mapping from source evidence and apply aliases; implementation tests use temporary workspaces only.
