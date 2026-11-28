# post-license-search

## Overview

The intake source for namespace `com/site/my/mnitservices/post-license-search`: Minnesota POST agencies, officers, licenses, education, and disciplinary records from the MN POST license search. `acquire` drives a Playwright browser to save the site's raw files, and `transform` reads those files and emits the artifacts listed in `intake.source.ts:source`. The transform uses no network, clock, or randomness.

Three `.xlsx` workbooks sit in this folder ("Final Disciplinary Actions item 5", "Law Enforcement Agencies request item 2", "Law Enforcement Agencies request item 3"); `acquire/discipline-workbooks.ts:WORKBOOK_FILES` names each of them.

Every row the transform reads has one of four outcomes: it is emitted; it is left out and reported as a finding in `metadata.defects` of the `mn-post` `LicensingAuthorities` record, of the officer's `Personnel` record or of the `Disciplines` record; it stops the transform with an error; or it is counted as not selected. The transform returns the counts for each input in `accounting`.

## Interface

- `intake.source.ts:source` - the `IntakeSource`: `description`, `produces` (`LicensingAuthorities`, `AuthorityLicenses`, `Agencies`, `Personnel`, `PersonnelEducations`, `Licenses`, `AgencyPersonnel`, `Disciplines`, `CoverageLinks`), `acquire`, `transform`.
- `acquire.ts:acquire` - `SourceAcquire`; `({ sourceDir, state, env, logger }) => Promise<void>`. Runs the acquire steps in [`./acquire/README.md`](./acquire/README.md) in order.
- `transform.ts:transform` - `SourceTransform`; `({ paths }) => Promise<{ artifacts, accounting, personnelSourceNames? }>`. Reads `agency-ids.yaml`, the agency `.csv`, `*.roster.json`, `*.detail.json`, `discipline-personnel.json`, `discipline-unresolved-licenses.json`, `discipline-unresolved-agencies.json`, `*.document.json` and `skipped.yaml` from `paths`. The `mn-post` `LicensingAuthorities` record, every `Personnel` record and every `Disciplines` record is emitted with `metadata.defects`, which is an empty list when the record has no finding.
- `transform.ts:transform` - `accounting` has one entry for each of these inputs: `agency-ids.yaml`, `agencies.csv`, `roster.json officers`, `detail.json licenses`, `detail.json activeEmployment`, `detail.json disciplinaryActions`, `detail.json education`, `discipline-personnel.json people`, `discipline-personnel.json history`, `discipline-personnel.json missingActions`, `discipline-unresolved-licenses.json`, `document.json`, `skipped.yaml skippedAgencies`, `skipped.yaml skippedDocuments`. A roster row is counted as emitted when it wrote an `AgencyPersonnel` record and as reported when it has a finding.
- [acquire](./acquire/README.md) - the acquire steps: site client, agency CSV, agency id cache, discipline workbooks, order documents, order analysis, skip report.

## Invariants

- `transform.ts:transform` - throws when `paths` has no `agency-ids.yaml`, and when an entry in it has a blank `id`. An entry whose agency has no roster and no employment history is counted as not selected (`no roster or employment history`).
- `transform.ts:AGENCY_CSV` (not exported) - the agency CSV is optional. When `paths` has a `.csv` file with at least one row, it must contain every listed column; checked with `assertRequiredColumns`.
- `transform.ts:transform` - an agency CSV row with a blank agency name throws, as do two rows for one agency name with different content. A row whose agency is not emitted must be in `skippedAgencies` of `skipped.yaml`, or the transform throws; a row skipped with `acquire/collect.ts:EXCLUDED_AGENCY_REASON` is counted as not selected (`excluded`), and a row skipped for another reason is counted as reported.
- `transform.ts:transform` - a `skippedAgencies` entry with a reason other than `EXCLUDED_AGENCY_REASON` is reported on the licensing authority with code `agency-not-found`.
- `transform.ts:transform` - a roster that is not a list throws. A roster with officers whose agency is not in `agency-ids.yaml` throws; an empty unmapped roster is skipped.
- `transform.ts:transform` - a roster row with a blank `contactId` or a blank `licenseId` throws, naming the roster file and the row. Two roster rows with one `contactId` and different names throw "conflicting person".
- `transform.ts:transform` - a roster row with no first name emits nothing and is reported on the licensing authority with code `roster-officer-without-name`.
- `transform.ts:transform` - a roster row emits `AgencyPersonnel` records only when it has both an `originalLicenseIssueDate` and a `licenseType`. A row that lacks either emits its `Personnel` record and no `AgencyPersonnel` record, and is reported on the licensing authority with code `roster-officer-without-assignment`. For a row that has both, no `activeEmployment` `rosterId` for that contact and agency throws. Two roster rows for one contact at one agency write the same `rosterId` records, and the later row replaces the earlier.
- `transform.ts:toDate` (not exported) - a date value that is not blank and does not start with `YYYY-MM-DD` throws; a blank value is null.
- `transform.ts:rowsOf` (not exported) - `activeEmployment`, `disciplinaryActions` and `education` in a detail file must each be a list, the site's text for none ("No employment found", "No POST Disciplinary Actions found", "No Courses found"), or absent; any other value throws.
- `transform.ts:transform` - an `activeEmployment` row with a blank `rosterId` or `agencyName` throws, as does a detail file with `activeEmployment` rows and no contact. A row for a contact and agency with no roster row is counted as not selected (`officer is not on that agency's roster`).
- `transform.ts:transform` - two `discipline-personnel.json` people whose license ids map to the same detail file name with different contacts throw "conflicting request contact identity".
- `transform.ts:transform` - a detail file whose license `contactId` differs from the contact confirmed in `discipline-personnel.json` throws.
- `transform.ts:addLicense` (not exported) - two different specs for the same contact and canonical license type throw.
- `transform.ts:transform` - conflicting `Personnel`, history assignment, discipline complaint, document evidence, or education course specs for the same key throw.
- `transform.ts:transform` - a history agency missing from `agency-ids.yaml` throws unless `discipline-unresolved-agencies.json` lists it with kind `skip` and a reason; the omitted assignment is reported on the licensing authority with code `employment-history-agency-not-found`. An entry in that file with another kind, a blank reason or a blank agency name throws "malformed unresolved agency report".
- `transform.ts:transform` - a license, disciplinary action, or education course that names a `contactId` with no `Personnel` record throws, as does one missing its identifying fields.
- `transform.ts:transform` - when `paths` has `discipline-personnel.json`, it must also have `discipline-unresolved-licenses.json`, and `missingActions` must be a list; otherwise it throws. Each `discipline-unresolved-licenses.json` entry is reported on the licensing authority with code `disciplined-license-not-found`, and each `missingActions` entry with code `disciplined-license-without-action`. A `missingActions` entry whose license is not in `people` throws.
- `transform.ts:transform` - a disciplinary action with a `documentURL` needs either a matching `*.document.json` or a matching `skippedDocuments` entry in `skipped.yaml` with no leftover `.pdf`; otherwise it throws "document incomplete". An action whose document was skipped is emitted without the order fields and carries a finding with code `order-document-unavailable`.
- `transform.ts:transform` - a `*.document.json` or a `skippedDocuments` entry that no disciplinary action cites throws.
- `transform.ts:transform` - when `*.document.json` files exist for a disciplinary action's `documentURL` but none lists that action's contact and case number, it throws "document actions do not match <case number>".
- `transform.ts:transform` - a `skipped.yaml` whose `skippedDocuments` is not a list throws "malformed skipped document report"; each entry must parse as `UnavailableDocumentSchema`. A `skipped.yaml` whose `skippedAgencies` is not a list, or has an entry with a blank `agencyName` or `reason`, throws "malformed skipped agency report".
- `transform.ts:transform` - a `Disciplines` record is keyed `<contactId>|<complaintId>`. A `CoverageLinks` record with the same key is emitted for each disciplinary action that has a `documentURL`.
- `transform.ts:transform` - an education course with a blank name emits no `PersonnelEducations` record and is reported once on the officer's `Personnel` record with code `education-course-without-name`.
- `transform.ts:addAgency` (not exported) - `city`, `address` and `zip_code` are omitted, not null, when the CSV lacks them; `state` defaults to `MN`.
- `acquire.ts:createLazyPostClient` (not exported) - the license search is opened on first use only.
- `acquire.ts:acquire` - a `MN_POST_CAPTCHA_WAIT_MS` that is set and is not a number throws before the browser is launched.
- `acquire.ts:loadAgencyFilters` (not exported) - throws when `supplementalAgencies` in `acquire/agency-filters.yaml` is not a list.

## Side Effects

- `acquire.ts:acquire` - launches a Playwright Chromium persistent context with its profile at `<state>/browser-profile`; reads `MN_POST_CAPTCHA_WAIT_MS`, `MN_POST_HEADLESS`, `CHROME_EXECUTABLE_PATH` and `ANTHROPIC_API_KEY` from `env`.
- `acquire.ts:acquire` - creates `<sourceDir>/workbooks` and copies each `WORKBOOK_FILES` workbook from this folder into it when it is not already there.
- `acquire.ts:loadAgencyFilters` (not exported) - reads `acquire/agency-filters.yaml`.
- `acquire.ts:loadExcludedAgencyNames` (not exported) - reads the excluded records in state through `loadExcludedRecords` and keeps the `key` and `name` of those of kind `Agency`.
- `acquire.ts:acquire` - network calls, subprocesses and file writes made by the steps it calls are listed in [`./acquire/README.md`](./acquire/README.md).
- `transform.ts:transform` - reads the files in `paths` (and the `.pdf` beside each `*.document.json`, through `readDocumentEvidence`). No network, database or log calls.

## Verification

- Run: `npx vitest run test/sources/com/site/my/mnitservices/post-license-search`
