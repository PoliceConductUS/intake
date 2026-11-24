# net/clearinghouse/api

## Overview

Intake source for the Civil Rights Litigation Clearinghouse (source namespace
`net/clearinghouse/api`). The acquire phase searches the Clearinghouse API for
policing civil cases for every agency that has at least one officer and writes
one `<agency ID>.cases.json` file per searched agency. The transform phase
reads those files and returns `CivilCases`, `CivilCasePersonnel` and
`CivilCaseLinks` artifacts for cases whose defendants name the agency and
include at least one officer that resolves to an `agency_personnel` record. It
also returns a `LicensingAuthorities` artifact that carries a finding for each
such case it could not build, on the licensing authority of the agency's
state. Every case read ends as emitted, reported or counted under a reason.

## Interface

- `intake.source.ts:source` - the `IntakeSource` declaration: `description`,
  `produces: ["CivilCases", "CivilCasePersonnel", "CivilCaseLinks", "LicensingAuthorities"]`,
  `acquire` and `transform`. It declares no `request`.
- `acquire.ts:acquire` - `SourceAcquire`,
  `({ sourceDir, env, data, logger }) => Promise<void>`. Searches the
  Clearinghouse per agency name and state, attaches each case's dockets, and
  writes the per-agency `.cases.json` files.
- `acquire.ts:isNoResults` - `(status, body) => boolean`. True only for a 400
  response whose body is an array whose first entry starts with `No results`.
- `transform.ts:transform` - `SourceTransform`,
  `({ paths, data, env, logger }) => { artifacts, accounting }`. Returns four
  artifacts: `CivilCases`, `CivilCasePersonnel` and `CivilCaseLinks`, each a
  map of record key to `{ spec }`, and `LicensingAuthorities`, built by
  `stateAuthorityRecords`. `accounting` has one entry, for the input `cases`.
- `state-ids.ts:CLEARINGHOUSE_STATE_ID` - `Record<string, number>` from an
  upper-case two-letter code (50 states, DC, GU, MP, PR, VI) to the
  Clearinghouse `state` query-parameter id.

Shared code used: `slugify` and `isPersonName` from
[`../../../lib/civil-defendants.ts`](../../../lib/README.md),
`civilCaseNaturalId`, `courtTokenFromName` and `normalizeDocketNumber` from
[`../../../lib/civil-case-id.ts`](../../../lib/README.md), and
`stateAuthorityRecords` from
[`../../../lib/state-authority-findings.ts`](../../../lib/README.md).

## Invariants

- `acquire.ts:acquire` - throws
  `net/clearinghouse/api: CLEARING_HOUSE_API_TOKEN is required to search the Clearinghouse.`
  when the token is missing or blank, before any disk or network activity.
- `acquire.ts:acquire` (inner `fetchJson`) - throws
  `Refusing an authenticated request outside the API origin.` when a URL,
  including a `next` pagination URL returned by the API, is not on the origin
  of `https://clearinghouse.net/api/v2p1`.
- `acquire.ts:acquire` (inner `fetchJson`) - only a 429 or a status of 500 or
  more is retried, up to `MAX_RETRIES` (5) times, waiting the `retry-after`
  seconds or an exponential backoff capped at `MAX_BACKOFF_MS` (60,000 ms). Any
  other non-2xx response that is not `isNoResults` throws.
- `acquire.ts:acquire` (inner `casesForAgency`) - every search sends
  `case_type=5039` (`POLICING_CASE_TYPE`) and follows `next` until it is empty.
- `acquire.ts:resultsList` (not exported) - a search page whose `results` is
  not a list, and a dockets response that is neither a list nor an object with
  a `results` list, throws `clearinghouse: <url> has no list of results.`
- `acquire.ts:acquire` (inner `docketsForCase`) - `docket_entries` is removed
  from every docket row before it is written. The dockets are cached by case
  ID for the run, so a case found under several agencies is fetched once.
- `acquire.ts:acquire` - agencies come from
  `data.agencies({ minOfficers: 1, cursor, limit: 50 })`. An agency with an
  empty name throws
  `net/clearinghouse/api: agency <agency ID> has a blank name.`, and an agency
  whose state has no entry in `CLEARINGHOUSE_STATE_ID` throws
  `net/clearinghouse/api: agency <agency ID> has a state the Clearinghouse has no ID for: <state>.`
  Agencies are searched in order, so no request is made for an agency after
  the one that throws.
- `acquire.ts:acquire` - an error while searching one agency, including a
  response with no list of results, is caught, logged with the agency's name
  and ID as `search failed, skipped`, counted as failed, and the loop
  continues; `acquire` itself does not throw for it and writes no file for
  that agency.
- `acquire.ts:acquire` - the file name is
  `encodeURIComponent(agencyId)` followed by `.cases.json`, where `agencyId`
  is the agency's source ID. The agency's name and state are not part of the
  name, so two agencies with one name each have their own file.
- `transform.ts:transform` - throws
  `net/clearinghouse/api: run requires a data context (DATABASE_URL) to resolve officers.`
  when `data` is undefined.
- `transform.ts:transform` - the minimum filing year is
  `Number(env.CLEARINGHOUSE_MIN_YEAR)`, and `DEFAULT_MIN_YEAR` (2022) when the
  setting is absent. A setting that is blank or not a whole number throws
  `net/clearinghouse/api: CLEARINGHOUSE_MIN_YEAR is not a year: <value>.`
- `transform.ts:transform` - a `.cases.json` file with an empty `agency.id`,
  `agency.name` or `agency.state` throws
  `net/clearinghouse/api: <file> has no agency ID, name or state.`; a file
  whose `cases` is not a list throws
  `net/clearinghouse/api: <file> has no list of cases.`; a case with no `id`
  throws `net/clearinghouse/api: <file> case <position> has no ID.`
- `transform.ts:transform` - the filed date is the first 10 characters of
  `filing_date` when it starts with `YYYY-MM-DD`, otherwise
  `<filing_year>-01-01` when `filing_year` is a number, otherwise the case has
  no filed date.
- `transform.ts:transform` - every case of every file is counted as read and
  ends in one outcome. The tests are made in this order, and the first that
  applies decides:
  1. The agency's name has no distinctive token: counted as not selected
     under `agency name has no distinctive word`. The agency is named in one
     log line for its file.
  2. The case has a filed date before January 1 of the minimum year: counted
     under `filed before the minimum year`.
  3. No defendant names the agency (`namesAgency`, not exported): counted
     under `no defendant names the agency`.
  4. No defendant resolves through `data.resolvePersonnel`: counted under
     `names no officer the database knows`.
  5. The title is empty or the case has no filed date: no case is emitted,
     the case is counted as reported, and one finding with the code
     `civil-case-not-buildable` goes on the licensing authority of the
     agency's state. Its `source_record_id` is the Clearinghouse case ID, its
     `value` holds the case's `name`, `filing_date` and `filing_year`, and its
     `evidence` is the case's `clearinghouse_link`, or the file name and case
     ID when the case has no link. A case left out of several files of one
     state has one finding; it throws
     `net/clearinghouse/api: case <case ID> in <file> differs from the same case in another file of the same state.`
     when the `value` differs.
  6. Otherwise the case is emitted and counted as emitted.
- `transform.ts:transform` - the `LicensingAuthorities` artifact holds one
  record for the state of every file read, on every run, with an empty
  `defects` list when no case of that state was reported.
- `transform.ts:transform` - `accounting` is
  `{ input: "cases", read, emitted, reported, notSelected }`, where
  `notSelected` holds the four reasons above. A case found in two agencies'
  files is read, and counted, twice.
- `transform.ts:namesAgency` (not exported) - true when any distinctive token
  of the agency name is a substring of the normalized institution and name of
  a defendant. A distinctive token is a token of the normalized agency name
  with 3 or more characters that is not in `AGENCY_STOPWORDS`.
- `transform.ts:transform` - only defendants whose name passes `isPersonName`
  are sent to `data.resolvePersonnel({ agencyId, personnelName })`.
- `transform.ts:caseIdentity` (not exported) - the case `id` is
  `civilCaseNaturalId(courtToken, docketNumber)` when the docket number is not
  empty, otherwise `<courtToken>:<slugify(title)>`:
  - The docket used is the first with `is_main_docket`, else the first with a
    `docket_number_manual`, else the first docket.
  - The docket number is that docket's `docket_number_manual`, else its
    `recap_docket_number`, passed through `normalizeDocketNumber`.
  - The court token is `courtTokenFromName` of that docket's `court`, else of
    the case's `court`.
- `transform.ts:transform` - record keys are the case ID for `CivilCases`,
  `<caseId>|clearinghouse` for `CivilCaseLinks` and
  `<caseId>|<agencyPersonnelId>` for `CivilCasePersonnel`. A case ID seen again
  in another agency's file with a different `CivilCases` spec throws
  `net/clearinghouse/api: case <caseId> in <file> differs from the same case in <earlier file>.`
- `transform.ts:transform` - a `CivilCaseLinks` record is written only when
  the case's `clearinghouse_link` is not empty.

## Side Effects

- `acquire.ts:acquire` - network: HTTP GET with the header
  `Authorization: Token <CLEARING_HOUSE_API_TOKEN>` to
  `https://clearinghouse.net/api/v2p1/cases/` (search and its `next` pages) and
  `https://clearinghouse.net/api/v2p1/cases/<id>/dockets/`. The token is read
  from the `env` passed in, not from `process.env`.
- `acquire.ts:acquire` - disk: creates `sourceDir`, appends one JSON line per
  HTTP attempt to `<sourceDir>/.api-calls.jsonl` (time, URL, status, and the
  body of a non-2xx response; never the token), and writes or overwrites
  `<sourceDir>/<encoded agency ID>.cases.json` for every searched agency,
  including one with zero cases.
- `acquire.ts:acquire` - database, through the data context:
  `data.agencies(...)`, paged until there is no `nextCursor`.
- `acquire.ts:acquire` - waits with `setTimeout` before each retry, reads the
  clock for each `.api-calls.jsonl` line, and logs progress through
  `logger.info`.
- `transform.ts:transform` - disk reads only; it writes no file. It reads each
  entry of `paths` that ends with `.cases.json`. Only when no entry ends with
  `.cases.json` does it call `readdir` on each input path
  (`collectEnvelopePaths`, not exported) and read the `.cases.json` files
  found; an input path that cannot be listed fails the transform with the
  `readdir` error.
- `transform.ts:transform` - database, through the data context:
  `data.resolvePersonnel(...)` once per person-named defendant of every case
  that passes the minimum-year and `namesAgency` tests. The call is made
  before the case is known to be kept.
- `transform.ts:transform` - reads `CLEARINGHOUSE_MIN_YEAR` from the `env`
  passed in and logs through `logger.info` one summary line and one line for
  each agency whose name has no distinctive token.
- `intake.source.ts`, `state-ids.ts` and `acquire.ts:isNoResults` have no side
  effects.

## Verification

- Run:
  `npx vitest run test/sources/clearinghouse-api test/sources/api-pagination.test.ts`
