# US officer sex-crime reporting spreadsheet

The [Police Sexual Violence Project arrest tracker](https://www.psvproject.org/2026-arrest-tracker) publishes a separate Google Sheet for each year.
Acquisition saves both workbooks and their row references by year. A shared
article URL is fetched once and retains references to each workbook that cites it.

- [Police Sexual Violence (2025)](https://docs.google.com/spreadsheets/d/1tX4F7XP5_5jZEebNQ8ibHR476CsrpLifCWc9nee8uIU/edit)
- [Police Sexual Violence (2026)](https://docs.google.com/spreadsheets/d/1Z8LXhEe-_DDeOW_qC8cqnmOicFBzDxx8NzsOdUVfQOU/edit)

`2026-10-15.xlsx` is the unmodified XLSX export retrieved on 2026-10-15 from:
https://docs.google.com/spreadsheets/d/1Z8LXhEe-_DDeOW_qC8cqnmOicFBzDxx8NzsOdUVfQOU/export?format=xlsx

SHA-256: `ff41883bf63770fb10142ca7a66dde25bfaf12084050fe2df8d50e380e06aa04`

In that 2026 snapshot, the `GENERAL` worksheet has headers in row 3, 345 named entries, and nine
additional links under “Investigation Without Outcome.” Preserve the original
cell values and embedded hyperlink targets. The sheet identifies names, titles,
states, attributed categories, arrest/sentence labels, and article links; it
does not contain an agency column. Its labels are source assertions.

## Acquisition and mapping

Run the source with Intake’s CLI in the configured workspace.

```bash
npm run cli -- data acquire org/psvproject/arrest-tracker
npm run cli -- data transform org/psvproject/arrest-tracker
npm run cli -- data generate org/psvproject/arrest-tracker
npm run cli -- data up
```

Acquisition preserves the workbook, parsed row references, response bodies,
response statuses, retrieval times, and SHA-256 digests under its command output.
The October 15 snapshot of the 2026 workbook contains 354 linked rows and 350 distinct URLs.

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
- Applied chain entry `000018` in the original workspace: 24 creates,
  with no personnel creation. Every supplied field was compared with the stored
  database row after import.
- Restored the two already-applied migration files from the existing Oregon
  worktree and regenerated migration metadata. No database reset was needed.

The October 16 acquisition ran under the original source name in `dev-copy`.
Its command record survives. The retained reviewed input in `dev` is under
`command/2026-10-18T18-29-48-883Z-zlgtn3oyq037220w2fb1tejt/org/psvproject/arrest-tracker/output`.
The unresolved report is `../intake-workspace/dev/state/org/psvproject/arrest-tracker/mapping-report.json`.

## 2026-10-18 reconciliation

Corrected five reviewed agency abbreviations to their existing database names,
with explicit entries in `review-notes.json`. All five agencies resolve, but
their named officers are absent from the matched rosters. The mapped coverage
total remains 11 articles and 13 employment associations. The original 218
agency failures are individually classified in source-state
`agency-resolution-audit.json`; the refreshed mapping report has 213 unresolved
agency pairs and 15 unresolved officer pairs.
