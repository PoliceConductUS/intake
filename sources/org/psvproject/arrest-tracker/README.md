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
state-mismatched, and unavailable records, and the mapped officers, are written
to the source's `mapping-report.json` under the intake workspace's source state
directory. An unsupported passage is not reported there; it stops the
transformation with an error. A workbook row with an empty link cell is
reported as a finding on the licensing authority of the row's state, and every
workbook row is counted as emitted, reported or not selected under a reason.

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
The unresolved report is `$INTAKE_WORKSPACE/state/org/psvproject/arrest-tracker/mapping-report.json`.

## 2026-10-18 reconciliation

Corrected five reviewed agency abbreviations to their existing database names,
with explicit entries in `review-notes.json`. All five agencies resolve, but
their named officers are absent from the matched rosters. The mapped coverage
total remains 11 articles and 13 employment associations. The original 218
agency failures were individually classified in a source-state file named
`agency-resolution-audit.json`; no code in this repository writes or reads a
file of that name. The refreshed mapping report has 213 unresolved
agency pairs and 15 unresolved officer pairs.

## Interface

- `intake.source.ts:source` - the `IntakeSource` object:
  `{ description, produces: ["CoverageLinks", "CoverageLinkAgencyPersonnel", "LicensingAuthorities"], acquire, transform }`.
- `acquire.ts:acquire` - `SourceAcquire`, `async ({ sourceDir, logger })`.
  Downloads each workbook in `spreadsheet.ts:spreadsheets`, fetches the linked
  articles, and copies `reviewed.json` and `review-notes.json` into `sourceDir`.
- `acquire.ts:acquireArticles` -
  `async (urls, dir, request?, log?) => Promise<Article[]>`. Fetches the URLs
  six at a time and returns one `Article` per URL in input order.
- `acquire.ts:articleText` -
  `(body: Buffer) => { title: string | null; text: string }`. The page title and
  the page text with `script`, `style`, `noscript`, `nav`, `footer`, and
  `header` removed and whitespace collapsed.
- `acquire.ts:digest` - `(value: string | Buffer) => string`, the SHA-256 hex
  digest.
- `acquire.ts:Article` - type
  `{ url, retrievedAt, status, finalUrl, bodyFile, sha256, textFile, title, error }`,
  one acquired article result.
- `spreadsheet.ts:spreadsheets` - the 2025 and 2026 workbooks as
  `{ year, url, exportUrl }`.
- `spreadsheet.ts:readSpreadsheet` -
  `async (bytes: ArrayBuffer) => Promise<SourceRow[]>`. Reads columns 1 to 6
  of the `GENERAL` worksheet from row 4 on.
- `spreadsheet.ts:SourceRow` - type
  `{ row, name, title, state, category, outcome, linkText, url }`. `url` is
  `null` for a row whose link cell is empty.
- `transform.ts:transform` - `SourceTransform`,
  `async ({ paths, state, data, logger })`. Returns
  `{ artifacts: [{ kind: "CoverageLinks", records }, { kind: "CoverageLinkAgencyPersonnel", records }, { kind: "LicensingAuthorities", records }], accounting }`
  and writes `mapping-report.json` to `state`. The `LicensingAuthorities`
  records are built by `stateAuthorityRecords` from
  [`../../../lib/state-authority-findings.ts`](../../../lib/README.md).
- `reviewed.json` - array of
  `{ url, sha256, officers: [{ name, agency, state, passages }] }`, copied by
  `acquire.ts:acquire`. `transform.ts:Review` (not exported) validates the
  copy in the folder of the acquired `articles.json`, not the checked-in file.
- `review-notes.json` - array of `{ url, rows?, reason }` (5 of the 56 entries
  have no `rows` key), copied by `acquire.ts:acquire`. No code in this folder
  reads its content.
- `2026-10-15.xlsx` - not read by the code in this folder.

## Invariants

- `spreadsheet.ts:readSpreadsheet` throws `Missing GENERAL worksheet` when the
  worksheet is absent, `Unexpected spreadsheet header in column <n>` when row 3
  is not `Name:`, `Title:`, `State:`, `Form of Violence:`, `Arrest or Sentence`,
  `Link:`, and `Invalid article URL at row <row>` when a link is not an
  `http` or `https` URL.
- `spreadsheet.ts:readSpreadsheet` passes over a row whose columns 1 to 6 are
  all empty; such a row is not a workbook row. Every other row is returned. A
  row whose link cell is empty is returned with `url: null`. In the
  2026-10-15 workbook those are row 351 (`Year to Date: 345`) and row 353
  (`Investigation Without Outcome:`), and neither names a state.
- `acquire.ts:acquire` throws `Spreadsheet download: <year>: HTTP <status>` when
  a workbook download is not ok, and reads the workbook with
  `spreadsheet.ts:readSpreadsheet` before it writes `source.xlsx` or
  `spreadsheet.json`.
- `acquire.ts:acquire` de-duplicates article URLs across both workbooks before
  `acquire.ts:acquireArticles`, and requests no article for a row whose `url`
  is `null`.
- `acquire.ts:acquireArticles` does not throw on a failed request or a non-ok
  response; it records the failure in the `error` field of the `Article`. It
  writes each batch's files before it starts the next batch.
- `acquire.ts:acquireArticles` names article files by `acquire.ts:digest` of the
  URL; `Article.sha256` is the digest of the response body.
- `transform.ts:transform` throws
  `Article mapping requires agency and personnel resolvers` without
  `data.resolveAgency`, `Missing acquired spreadsheet.json` and
  `Missing acquired articles.json` when `paths` lacks those files, and
  `Missing spreadsheet URL` when a `spreadsheet.json` has no `url`.
- `transform.ts:Review` (not exported) requires `reviewed.json` to be an array of strict
  objects: a URL, a `sha256`, and officers with a non-empty `name` and `agency`,
  a two-letter upper-case `state`, and at least one non-empty passage. Unknown
  keys are rejected.
- `transform.ts:transform` throws `Duplicate reviewed article URL` when two
  reviews share a URL.
- `transform.ts:transform` throws `Article digest changed: <url>` unless the
  digest of the saved body, `article.sha256`, and `review.sha256` are equal, and
  `Unsupported article passage: <url>` unless every passage is found in
  `acquire.ts:articleText` of the body.
- `transform.ts:transform` emits a record for an officer only when the agency
  resolves, `agency.location.state` equals the reviewed state, and the officer
  resolves at that agency. Every other case emits nothing.
- `transform.ts:transform` writes one `mapping-report.json` entry for each
  article that emits nothing as a whole (status `article-unavailable`,
  `identity-unreviewed` or `no-supported-officer-identity`) and one for each
  reviewed officer: status `mapped` with the officer's `agencyPersonnelId`, or
  `agency-unresolved`, `agency-state-unverified` or `officer-unresolved` with
  `agencyPersonnelId: null`.
- `transform.ts:transform` throws
  `org/psvproject/arrest-tracker: reviewed.json entry is not in articles.json: <url>`
  for a `reviewed.json` entry whose URL is not in `articles.json`,
  `org/psvproject/arrest-tracker: articles.json repeats an article URL` when
  two articles share a URL,
  `org/psvproject/arrest-tracker: no workbook row cites the article <url>` for
  an article that no row of the workbooks read cites, and
  `org/psvproject/arrest-tracker: <spreadsheet file> GENERAL row <row> cites an article that is not in articles.json: <url>`
  for a row whose article was not acquired.
- `transform.ts:transform` gives every workbook row one outcome and returns
  the counts as `accounting`, one entry with the input `GENERAL rows`:
  - A row whose `url` is `null` and whose state is not empty: counted as
    reported, with one finding on the licensing authority of the row's state.
    The finding has the code `tracker-entry-without-link`, the row's cells as
    its `value`, the workbook URL, sheet and row number as its `evidence`, and
    `<spreadsheet file>#<row>` as its `source_record_id`, where the file is
    the path of `spreadsheet.json` below the folder of `articles.json`.
  - A row whose `url` is `null` and whose state is empty: throws
    `org/psvproject/arrest-tracker: <spreadsheet file> GENERAL row <row> has an empty link cell and names no state: <name>`.
  - A row whose article emitted a `CoverageLinks` record: counted as emitted.
  - Any other row: counted as not selected under the reason of its article:
    `article could not be retrieved`, `article not reviewed` (no
    `reviewed.json` entry), `article supports no officer identity` (a review
    with no officers) or `names no officer the database knows` (no reviewed
    officer resolves).
- `transform.ts:transform` returns one `LicensingAuthorities` record for each
  state named by a workbook row, on every run, with an empty `defects` list
  when the state has no finding. A state cell that is not a two-letter code
  throws in `stateAuthorityRecords`.
- `transform.ts:transform` fills the records as follows:
  - `CoverageLinks`: `url`; `normalized_url`, computed locally (trim, strip
    trailing `/`, lower-case); `title`; `source_name`, the URL host name; and
    `notes`, which hold each workbook URL with its `GENERAL` row numbers and
    the article SHA-256.
  - `CoverageLinkAgencyPersonnel`: `coverage_link_id`, `agency_personnel_id`,
    `confidence: "named-in-article"`, and `notes`, which hold the reviewed
    passages followed by the same workbook and digest text.
- `transform.ts:transform` throws `Article title unavailable: <url>` when a
  mapped article has no title.
- `transform.ts:transform` keys `CoverageLinks` records by `acquire.ts:digest`
  of the article URL and `CoverageLinkAgencyPersonnel` records by
  `<that digest>|<agencyPersonnelId>`.

## Side Effects

- `acquire.ts:acquire` - network: `fetch` of each `exportUrl` in
  `spreadsheet.ts:spreadsheets`, each with a 30,000 ms timeout.
- `acquire.ts:acquireArticles` - network: one request per article URL, six at a
  time, each with a 20 second timeout.
- `acquire.ts:acquire` - files: creates `sourceDir` and `<sourceDir>/<year>`;
  writes `<sourceDir>/<year>/source.xlsx`,
  `<sourceDir>/<year>/spreadsheet.json`, `<sourceDir>/articles.json`,
  `<sourceDir>/reviewed.json`, and `<sourceDir>/review-notes.json`; reads the
  checked-in `reviewed.json` and `review-notes.json` beside the module.
- `acquire.ts:acquireArticles` - files: creates `<dir>/articles` and writes
  `<dir>/articles/<digest of URL>.json` for each article. It writes the `.html`
  body only when a response arrived, and the `.txt` text only when that
  response was ok: a failed request leaves only `.json`, and a non-ok response
  leaves `.json` and `.html`.
- `transform.ts:transform` - files: reads the acquired `spreadsheet.json`,
  `articles.json`, `reviewed.json`, and article bodies; creates `state` and
  writes `<state>/mapping-report.json`.
- `transform.ts:transform` - calls `data.resolveAgency` and
  `data.resolvePersonnel` on the data context it is given.
- `acquire.ts:acquireArticles`, `transform.ts:transform` - logging through the
  supplied logger.

## Verification

- Run: `npx vitest run test/sources/org/psvproject/arrest-tracker`
