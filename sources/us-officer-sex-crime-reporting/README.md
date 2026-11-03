# US officer sex-crime reporting spreadsheet

Source supplied by the user:
https://docs.google.com/spreadsheets/d/1Z8LXhEe-_DDeOW_qC8cqnmOicFBzDxx8NzsOdUVfQOU/edit?gid=0#gid=0

`2026-10-15.xlsx` is the unmodified XLSX export retrieved on 2026-10-15 from:
https://docs.google.com/spreadsheets/d/1Z8LXhEe-_DDeOW_qC8cqnmOicFBzDxx8NzsOdUVfQOU/export?format=xlsx

SHA-256: `ff41883bf63770fb10142ca7a66dde25bfaf12084050fe2df8d50e380e06aa04`

The `GENERAL` worksheet has headers in row 3, 345 named entries, and nine
additional links under “Investigation Without Outcome.” Preserve the original
cell values and embedded hyperlink targets. The sheet identifies names, titles,
states, attributed categories, arrest/sentence labels, and article links; it
does not contain an agency column. Its labels are source assertions.

## Acquisition and mapping

For the current local database, use `INTAKE_WORKSPACE` pointing to
`../intake-workspace/dev-copy`. Its applied history requires the newer runtime in
`/Users/dalelotts/.codex/worktrees/oregon-dpsst/intake/src/cli/index.ts`.
Run that entrypoint from this checkout so it discovers this source, using
`node --max-old-space-size=12288 --import tsx <entrypoint> data <command>`.
The standard commands below apply when the checkout runtime matches the database.

```bash
npm run cli -- data acquire us-officer-sex-crime-reporting
npm run cli -- data transform us-officer-sex-crime-reporting
npm run cli -- data generate us-officer-sex-crime-reporting
npm run cli -- data up
```

Acquisition preserves the workbook, parsed row references, response bodies,
response statuses, retrieval times, and SHA-256 digests under its command output.
All 354 linked rows are retained; their embedded links identify 350 distinct URLs.

`reviewed.json` records article-supported identities and brief exact passages,
bound to the downloaded article digest. `review-notes.json` records missing
evidence, source discrepancies, and ambiguous employers. The original spreadsheet
is not corrected. A changed article digest requires a new evidence review.

Transformation uses the shared agency and personnel resolvers and checks the
agency state. It emits CoverageLinks and CoverageLinkAgencyPersonnel only for
resolved existing records. It does not create officers. Missing, ambiguous,
state-mismatched, unavailable, and unsupported records remain in the source's
`mapping-report.json` under the intake workspace's source state directory.

## 2026-10-15 result

- All 350 URLs attempted: 269 responses reviewed and 81 failed retrievals.
- 246 responses support officer/employer identities; 23 lack usable identity
  evidence, including blank bodies, unrelated pages, and unnamed subjects.
- Imported 11 article records and 13 employment associations covering 12 existing
  officers. All 13 associations were checked against their persisted canonical
  mappings and database agency/personnel rows.
- Applied chain entry `000018` in `../intake-workspace/dev-copy`: 24 creates,
  with no personnel creation. Every supplied field was compared with the stored
  database row after import.
- Restored the two already-applied migration files from the existing Oregon
  worktree and regenerated migration metadata. No database reset was needed.

The reviewed acquisition was staged unchanged in `dev-copy` under command
`2026-10-16T00-57-16-088Z-d3dhzo1dxxe5en01m6sn861p/us-officer-sex-crime-reporting/output`.
The unresolved report is `../intake-workspace/dev-copy/state/us-officer-sex-crime-reporting/mapping-report.json`.

## 2026-10-18 reconciliation

Corrected five reviewed agency abbreviations to their existing database names,
with explicit entries in `review-notes.json`. All five agencies resolve, but
their named officers are absent from the matched rosters. The mapped coverage
total remains 11 articles and 13 employment associations. The original 218
agency failures are individually classified in source-state
`agency-resolution-audit.json`; the refreshed mapping report has 213 unresolved
agency pairs and 15 unresolved officer pairs.
