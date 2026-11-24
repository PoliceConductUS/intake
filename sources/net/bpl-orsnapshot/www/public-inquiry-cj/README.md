# Oregon DPSST — public CJ IRIS

Source: [Oregon DPSST public records](https://www.oregon.gov/dpsst/CJ/Pages/PublicRecords.aspx)
and [CJ IRIS](https://www.bpl-orsnapshot.net/PublicInquiry_CJ/EmployeeSearch.aspx).

This source collects agencies, personnel, dated employment history and
certifications. It uses the public search form and ordinary session cookies;
no account or records request is required. Training and education are not part
of this source's initial implementation.

## Run

```sh
npm run cli -- data acquire net/bpl-orsnapshot/www/public-inquiry-cj
npm run cli -- data transform net/bpl-orsnapshot/www/public-inquiry-cj
npm run cli -- data generate net/bpl-orsnapshot/www/public-inquiry-cj
npm run cli -- data up
npm run cli -- data verify
```

Acquisition searches A–Z and follows pagination. Interrupted acquisitions resume through the CLI: completed search prefixes,
officer detail sets and agency responses are validated and reused. A unit with no saved pages, or whose last saved page still links to a next page, is fetched again. A saved unit that is invalid (a page out of sequence, a repeated page, a page that does not link to the next, or a page its parser rejects) stops the acquisition with an error. A changed prefix scope requires a fresh acquisition. For a targeted verification run:

```sh
OREGON_DPSST_PREFIXES=Z npm run cli -- data acquire net/bpl-orsnapshot/www/public-inquiry-cj
```

A targeted run is not a statewide dataset. The acquisition manifest records its
prefixes and the raw HTML page files of each search, officer and agency. The
form pages `session-form.html` and `search-<prefix>-form.html` are saved but are
not in the manifest. `complete` means the configured acquisition
finished; it does not prove the public site contains every Oregon officer. DPSST
states that the public system generally covers people employed within the last
five years and is updated nightly.

## Meaning and identity

- DPSST numbers identify people; agency codes identify organizations.
- AgencyPersonnel represents active service. Leave (`LOA`, `Mil-LOA`,
  `LveNonCert`) ends active service on the leave date; return from leave starts
  a new AgencyPersonnel record. A separation that follows a leave with no
  return and no new start between them is the end of that employment: the
  AgencyPersonnel record ends on the separation date, not the leave date. No
  field of AgencyPersonnel holds the reason for the end. Promotions and rank
  changes do not invent new start dates. An agency or an employment that cannot be
  built is reported as a finding on the DPSST licensing authority and remains
  inspectable in the raw pages.
- Certificate type and level identify a license type. Source status dates produce
  license actions; certification status is separate from employment status.
- Expiration and probation dates remain in raw evidence because existing license
  fields cannot represent them. No schema fields or dates are fabricated.
- Agency addresses and contacts remain source data; shared intake validation,
  geocoding, place containment and identity mapping apply during generation.

The source contains other public-safety disciplines as well as police. Raw source
records are retained even when the shared import rules do not admit them.

## Rows left out

Every row the transform reads ends in one outcome. The transform returns the
counts for each input (`search pages`, `agency pages`, `employment pages`,
`certificate pages`) as `accounting`, and the shared transform step fails when
a count does not balance.

A row that cannot be built is left out and reported as one finding on the
`dpsst` `LicensingAuthorities` record (`metadata.defects`), which is emitted on
every run:

| Finding code                    | Left out                                                                                       | Source record ID                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `agency-not-in-agency-list`     | An agency whose agency page says "No Data Found"                                               | The agency code                           |
| `agency-not-buildable`          | An agency whose row fails `AgencySpec` (the page gives no address, city, state or ZIP code)    | The agency code                           |
| `employment-agency-unknown`     | An employment row whose agency name is in no search row                                        | `officer-<DPSST number>-employment#<row>` |
| `employment-without-start`      | A separation, leave or change with no earlier start at that agency                             | `officer-<DPSST number>-employment#<row>` |
| `employment-position-ambiguous` | A separation, leave or change that does not match exactly one employment at that agency        | `officer-<DPSST number>-employment#<row>` |
| `employment-unclear`            | An employment that an ambiguous row could belong to (reported at its start row)                | `officer-<DPSST number>-employment#<row>` |
| `employment-without-position`   | An employment with no rank in any of its rows (reported at its start row)                      | `officer-<DPSST number>-employment#<row>` |
| `employment-without-end`        | An employment with no end, for an officer the search rows do not show as active at that agency | `officer-<DPSST number>-employment#<row>` |

`<row>` is the number of the row in the officer's employment table counted
from the oldest event. The table lists the newest event first, so the last
data row of the officer's last employment page is row 1 and the count goes up
through every page to the first data row of the first page. A newer event
added at the top therefore changes no earlier row's number, also when it moves
a row to the next page. The page file is not part of the ID because it names a
page, and a row can move to another page. The finding's evidence gives the page
file and the row's number from the top of that page as they were when the
pages were saved.

An employment row at an agency that was left out, and every other row of an
employment that was left out, is counted as reported under that finding and
gets no finding of its own.

A row the selection rule does not take is counted under a reason and gets no
finding:

- `no AgencyPersonnel` - an agency with no `AgencyPersonnel` record in the
  output (see Publication scope).
- `certification action` - an employment row whose action is `CertDenied`,
  `Cert Riens`, `CertRevoke`, `CertSuspnd` or `InstrApp`. These are not
  employment events.
- `separation after separation` - a separation at an agency where an earlier
  separation already ended the officer's employment and no start follows it,
  such as `Deceased` after `Retired`. The end date stays that of the first
  separation.
- `leave while not in active service` - a leave at an agency where the officer
  is already on leave or the employment has ended, with no start between.
- `repeated row` - a row identical to an earlier row of the same officer, or a
  search row identical to an earlier search row.

A condition the saved pages have never shown stops the transform with an error:
a certificate row with a blank certificate type, status or status date, an
employment action that is not in `employment.ts`, and an agency name that two
agency codes share.

## Publication scope

All roster personnel are retained regardless of certificate presence, type,
level or status. Available employment relationships and actual supplied
credentials are retained. Empty certificate data produces no licenses. Strict
parsing and required-field validation still apply. No code in this folder reads
or applies a correction or an exclusion. Agencies without retained personnel assignments and
their phone records are omitted.

## Interface

- `intake.source.ts:source` - the `IntakeSource` declaration: `description`,
  `acquire`, `transform`, and `produces` (`LicensingAuthorities`,
  `AuthorityLicenses`, `Agencies`, `Personnel`, `AgencyPersonnel`, `Licenses`,
  `LicenseActions`, `AgencyPhoneNumbers`).
- `acquire.ts:acquire` - `SourceAcquire`, `({ sourceDir, env, logger })`.
  Takes the prefixes from `env.OREGON_DPSST_PREFIXES` (comma-separated) or A–Z
  and calls `acquireOregon` with a `createClient` requester.
- `acquire.ts:acquireOregon` -
  `({ sourceDir, prefixes, request, log? }) => Promise<void>`. The resumable
  acquisition that writes the raw HTML pages and `manifest.json` into
  `sourceDir`.
- `transform.ts:transform` - `SourceTransform`,
  `({ paths, logger }) => { artifacts, accounting }`. Reads the complete
  `manifest.json` and the HTML files it names and returns the eight artifacts
  listed in `produces` and the row accounting of its four inputs.
- `manifest.ts:manifestSchema`, `manifest.ts:AcquisitionManifest` - the strict
  zod schema and type of `manifest.json`:
  `{ version: 1, complete, prefixes, searchFiles, officers, agencies }`.
- `client.ts:createClient` - `({ fetch?, delayMs?, onSessionRenewal? }) => RequestHtml`.
  A cookie-keeping, throttled requester (GET without a body, form POST with
  one) that renews the session once.
- `client.ts:RequestHtml` - type `(url, body?: URLSearchParams) => Promise<string>`.
- `parse.ts:BASE_URL` - `https://www.bpl-orsnapshot.net/PublicInquiry_CJ/`.
- `parse.ts:parseSearch` - `(html) => Affiliation[]`. The rows of the search
  result table.
- `parse.ts:parseEmployment` - `(html, id) => EmploymentEvent[]`. The
  employment history rows of one officer.
- `parse.ts:parseCertificates` - `(html, id) => Certificate[]`. The
  certificate rows of one officer.
- `parse.ts:parseAgency` - `(html, expectedName) => Agency | null`. The one
  agency row with that name, or `null` for "No Data Found".
- `parse.ts:postbackFields` - `(html) => URLSearchParams`. The named hidden
  inputs of an ASP.NET page.
- `parse.ts:nextPage` - `(html, current) => { target, argument, page } | null`.
  The postback for the next page of a table.
- `parse.ts:sourceUrl` - `(href, page) => URL`. Resolves a link against
  `BASE_URL`.
- `parse.ts:Affiliation`, `parse.ts:Agency`, `parse.ts:EmploymentEvent`,
  `parse.ts:Certificate` - the parsed row types.
- `employment.ts:sourceDate` - `(value) => string`. Converts `M/D/YYYY` to
  `YYYY-MM-DD`.
- `employment.ts:buildEmploymentEpisodes` -
  `(events, affiliations, agencyAffiliations = affiliations)`. Maps each source
  action to `start`, `restore`, `leave`, `end`, `continue` or `unresolved`,
  reverses the
  order of the mapped events, and returns `{ assignments, issues, rows }` from
  `reconstructEmployment` in
  [`src/cli/transform/employment.ts`](../../../../../src/cli/transform/employment.ts).
  `rows[i]` is the outcome of `events[i]`.

## Invariants

- `client.ts:createClient` - throws `Unexpected acquisition origin` for a URL
  that is not on the origin of `BASE_URL`. Redirects are not followed, and a
  response that is not ok throws `Oregon request failed: HTTP <status> ...`. A
  transport failure or a timeout is rethrown as
  `Oregon request failed: <METHOD> <url>: <detail>`.
- `client.ts:createClient` - the session is renewed only on a 302 to
  `Logout.aspx`, and the original request is retried exactly once. The renewal
  is a GET of `EmployeeSearch.aspx`; it throws `Missing ASP.NET viewstate` when
  that page has no viewstate.
- `parse.ts:tableRows` (not exported; used by every `parse*` function) -
  throws `Missing <id> table`, `Malformed <id> headers`,
  `Missing <id> data rows`, `Malformed <id> row` or
  `Malformed <id> pagination row` when a table does not have the exact
  expected shape.
- `parse.ts:parseSearch` - throws `Missing affiliation links` or
  `Malformed affiliation identity` unless the officer ID, `RecID` and `RecNum`
  are digits, `AgcyID` matches `/^[A-Za-z0-9_]+$/`, and `AgcyID` equals the
  `Agcy` value of the agency link.
- `parse.ts:verifyOfficer` (not exported; used by `parseEmployment` and
  `parseCertificates`) - throws `Officer identity mismatch: ...` when the page
  is not for the requested officer ID.
- `parse.ts:parseAgency` - throws:
  - `Agency identity mismatch: expected one <name>` unless exactly one row has
    the expected name.
  - `Missing agency address fields` when the row lacks either address label.
  - `Malformed protected email` when the `data-cfemail` value is not two or
    more hex bytes.
  - `Unrecognized agency email` when the contact link has text but no
    `data-cfemail` value and no `mailto:` address.
- `parse.ts:postbackFields` - throws `Missing ASP.NET viewstate`.
- `parse.ts:nextPage` - throws `Unsupported pagination command` or
  `Pagination gap` when the next page is not exactly `current + 1`.
- `parse.ts:sourceUrl` - throws `Unexpected source URL` when the origin or
  page differs from the expected one.
- `employment.ts:sourceDate` - throws `Invalid DPSST date: <value>` unless the
  value is a real `M/D/YYYY` calendar date.
- `employment.ts:buildEmploymentEpisodes` - every event date is validated
  before its action is read. Certification actions (`CertDenied`,
  `Cert Riens`, `CertRevoke`, `CertSuspnd`, `InstrApp`) are not passed on and
  have the outcome `certification-action`, and an unknown action is passed on
  as `unresolved`.
- `manifest.ts:manifestSchema` - unknown keys are rejected at every level,
  `version` must be 1, and `prefixes` needs at least one entry.
- `acquire.ts:acquireOregon` - throws
  `Oregon prefixes must be distinct alphabetic names`, and
  `Cannot resume Oregon acquisition with a different prefix scope` when the
  saved `prefixes` differ from the requested ones.
- `acquire.ts:acquireOregon` - `manifest.complete` is written as `false`
  before the first request and set to `true` only after every search, officer
  and agency step finishes.
- `acquire.ts:completedPages` (not exported) - a set is fetched again only
  when it has no saved pages or its last saved page still links to a next
  page. Otherwise it throws `Invalid saved page sequence: <file>`,
  `Repeated saved page: <file>` or `Invalid saved pagination: <file>`, or the
  parser's own error, and the saved pages are reused when none is thrown.
- `acquire.ts:acquireOregon` - throws on a conflict in the evidence:
  - In the saved manifest: `Duplicate saved manifest identity`,
    `Invalid saved search identities`, `Unexpected saved officer identity`,
    `Unexpected saved agency identity` and `Invalid saved agency file for <id>`.
  - In the search pages: `Conflicting affiliation <recordId>`,
    `Repeated search page` and `Empty paginated search`.
  - In an officer's pages: `Repeated <tab> page for <id>` and
    `Empty paginated <tab>`, where `<tab>` is `employment` or `certificates`.
  - In an agency page: `Conflicting agency names for <id>` and
    `Agency identity mismatch for <id>: <name>`.
- `transform.ts:transform` - throws
  `Oregon DPSST requires exactly one complete manifest.json` unless `paths`
  holds exactly one `manifest.json`, and `Oregon acquisition is incomplete`
  unless `complete` is `true`.
- `transform.ts:transform` - every raw HTML file is read from the manifest's
  folder; a path outside it throws `Invalid raw evidence path <file>`. Page
  files must be complete and in sequence
  (`Invalid page files: expected <file>`,
  `Incomplete or extra page files after <file>`, `Missing page files for <stem>`).
- `transform.ts:transform` - throws when the manifest and the search pages
  disagree:
  - `Invalid manifest prefixes` unless the prefixes are distinct alphabetic
    names.
  - `Unexpected search page files` when a search file belongs to no prefix.
  - `Duplicate manifest identity <id>` (from `uniqueById`, not exported) when
    two officers or two agencies share an ID.
  - `Conflicting affiliation <key>` when two search rows with the same officer
    ID, agency code, `RecID` and `RecNum` differ.
  - `Missing manifest officer <id>` and `Missing manifest agency <id>` when a
    search row names an officer or agency that the manifest lacks.
  - `Conflicting agency names for <id>` unless the search rows give exactly
    one name for a manifest agency.
  - `Manifest officer <id> has no search evidence` when a manifest officer is
    in no search row.
- `transform.ts:put` (not exported) - a different spec under an existing
  record key throws `Conflicting source identity <key>`.
- `transform.ts:person` (not exported) - throws
  `Malformed personnel name: <name>`, `Ambiguous name suffix: <name>` or
  `Malformed name suffix: <name>` for a name that is not
  `Last, First [Middle][, Suffix]`.
- `transform.ts:transform` - record keys are source-local names: the agency
  code for `Agencies`, `<agency code>|Phone` for `AgencyPhoneNumbers`, the
  DPSST number for `Personnel`, `<DPSST number>|<agency code>|<start date>`
  for `AgencyPersonnel`, `dpsst|<type>` for `AuthorityLicenses`,
  `<DPSST number>|<type>` for `Licenses`,
  `<DPSST number>|<type>|<status>|<date>` for `LicenseActions`, and `dpsst`
  for `LicensingAuthorities`.
- `transform.ts:transform` - throws `Conflicting certificate evidence ...` or
  `Conflicting certificate status ...` when certificate rows disagree, and
  `<source>: <file> row <n> has a blank <cell>` for a certificate row with a
  blank certificate type, status or status date.
- `transform.ts:transform` - throws
  `<source>: <file> row <n> has an unknown action "<action>"` for an employment
  action that `employment.ts` does not map, and
  `<source>: <file> row <n> names agency "<name>", which has more than one agency code`.
- `transform.ts:transform` - throws
  `<source>: agency <id> fails the agency schema at an unexpected field: ...`
  when `AgencySpec.safeParse` fails on a field other than the name, address,
  city, state or ZIP code.
- `transform.ts:transform` - every row read is counted once in `accounting` as
  emitted, reported or not selected, as the section "Rows left out" states. The
  `dpsst` `LicensingAuthorities` record always carries `metadata.defects`,
  empty when no row was left out.
- `transform.ts:transform` - an agency with no `AgencyPersonnel` record in the
  output is deleted with its `AgencyPhoneNumbers` record and counted as not
  selected.

## Side Effects

- `client.ts:createClient` - network: GET and form POST to
  `https://www.bpl-orsnapshot.net`, with cookies kept in memory only. Requests
  are at least `delayMs` (default 250 ms) apart and each has a 45,000 ms
  timeout.
- `acquire.ts:acquireOregon` - network, through the injected `request`:
  `EmployeeSearch.aspx`, each officer's `EmployeeDetails.aspx` (employment and
  certificate tabs) and `AgencyList.aspx?Agcy=<id>`.
- `acquire.ts:acquireOregon` - disk: creates `sourceDir`; rewrites
  `manifest.json` after each saved page; writes `session-form.html`,
  `search-<prefix>-form.html`, `search-<prefix>-<n>.html`,
  `officer-<id>-employment-<n>.html`, `officer-<id>-certificates-<n>.html` and
  `agency-<id>.html`; reads the saved manifest and pages on resume.
- `acquire.ts:acquire` - reads `OREGON_DPSST_PREFIXES` from the `env` passed
  in and logs through `logger.info`.
- `transform.ts:transform` - disk reads only (`manifest.json` and the HTML
  files it names) and `logger.info` lines prefixed `dpsst:` (each issue from
  `buildEmploymentEpisodes` and one summary line). It writes no file and makes
  no request.
- `parse.ts`, `employment.ts`, `manifest.ts` and `intake.source.ts` have no
  side effects.

## Verification

- Run:
  `npx vitest run test/sources/net/bpl-orsnapshot/www/public-inquiry-cj`
