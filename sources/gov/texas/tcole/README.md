# gov/texas/tcole

## Overview

Source namespace `gov/texas/tcole`: reconstructs Texas agencies, officers, licenses, license actions, and assignments from the TCOLE public-information workbook. The source has a transform only; it declares no acquire. The transform reads four sheets of one `.xlsx` workbook and emits eight artifacts.

## Interface

- `intake.source.ts:source` - the `IntakeSource` for this namespace: a `description`, `transform`, and `produces` listing `LicensingAuthorities`, `AuthorityLicenses`, `Agencies`, `Personnel`, `Licenses`, `LicenseActions`, `AgencyPersonnel`, and `AgencyPhoneNumbers`.
- `transform.ts:transform` - a `SourceTransform` taking `{ paths, readXlsx, logger }`. It reads the `Departments`, `Services`, `Officers`, and `OfficersLicensesActions` sheets and resolves to `{ artifacts, accounting }`: one `{ kind, records }` entry per kind in `produces`, and one `InputAccounting` entry per sheet in the order `Departments`, `Officers`, `Services`, `OfficersLicensesActions`.

## Invariants

Every row a sheet holds ends in one outcome: it is emitted, it is reported as a finding, or the transform throws. No row is not selected, so `notSelected` is always empty.

- `transform.ts:transform` throws `gov/texas/tcole expects a single .xlsx workbook input, got <count>` followed by the paths unless exactly one input path ends in `.xlsx`. Input paths with another extension are not read.
- `transform.ts:transform` passes the column lists `DEPARTMENT`, `SERVICE`, `OFFICER`, and `ACTION` to `readXlsx` as the columns each sheet must have.
- All four sheets are required when the injected `readXlsx` is the shared `src/cli/transform/read-xlsx.ts:readXlsx`: it throws `Worksheet "<sheet>" not found` for a sheet the workbook lacks.
- `transform.ts:transform` throws `gov/texas/tcole: <sheet> row <number> has a blank <column>.` for a blank ID column, checked for every row as each sheet is read. The ID columns are `DEPARTMENT_NUMBER` in `Departments`; `PUBLIC_GUID` in `Officers`; `PUBLIC_GUID`, `DEPARTMENT_NUMBER`, and `LICENSE` in `Services`; `PUBLIC_GUID`, `LICENSE`, and `LICENSE_ACTION` in `OfficersLicensesActions`. A row number is the row in the sheet, where the header is row 1.
- `transform.ts:toDate` keeps a leading `YYYY-MM-DD`, returns an empty string for a blank cell, and throws `gov/texas/tcole: <sheet> row <number> <column> is not a date: <value>` for any other value. It reads `DATE_OFFICIAL`, `ST_DATE`, `END_DATE`, `DATE_AWARDED`, and `ACTION_DATE`.
- `transform.ts:assertNoConflict` throws `gov/texas/tcole: <sheet> row <number> repeats key <key> with different content.` when a later row has the key of an earlier row and different content. Rows that repeat a key with the same content are one record, and each of them is counted. The content compared is:
  - `Departments`: the `DEPARTMENT` columns of the row, by `DEPARTMENT_NUMBER`.
  - `Officers`: the `OFFICER` columns of the row, by `PUBLIC_GUID`.
  - `Services`: the AgencyPersonnel spec, by the AgencyPersonnel key; for a row with no start date, the `SERVICE` columns of the row.
  - `OfficersLicensesActions`: the LicenseAction spec, by the LicenseAction key. Rows that differ only in `DATE_AWARDED` are one LicenseAction.
- `transform.ts:assertKnown` throws `gov/texas/tcole: <sheet> row <number> names <column> <value>, which is not in the <Departments or Officers> sheet.` when a `Services` row names a department, or a `Services` or `OfficersLicensesActions` row names an officer, that no row of that sheet describes.
- `transform.ts:transform` builds in this order: agencies, agency phone numbers, personnel, authority licenses, licenses, license actions, agency personnel, licensing authorities.
- The builders named below are not exported. Record keys carry identity:
  - Agencies: `DEPARTMENT_NUMBER`.
  - AgencyPhoneNumbers: `<DEPARTMENT_NUMBER>|Phone` or `<DEPARTMENT_NUMBER>|Fax`.
  - Personnel: `PUBLIC_GUID`.
  - LicensingAuthorities: `tcole`.
  - AuthorityLicenses: `transform.ts:authorityLicenseKey`, `tcole|<canonical license>`.
  - Licenses: `transform.ts:licenseHoldingKey`, `<PUBLIC_GUID>|<canonical license>`.
  - LicenseActions: `<PUBLIC_GUID>|<canonical license>|<LICENSE_ACTION>|<ACTION_DATE>`.
  - AgencyPersonnel: `PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE`, with whitespace-normalized `APPOINTMENT` and `LICENSE`. A blank `APPOINTMENT` stays blank in the key.
  - For AuthorityLicenses and Licenses the first row with a key makes the record.
- `transform.ts:buildAgencies` validates each department with `AgencySpec.safeParse`. A department that fails is not emitted, is counted as reported, is logged, and gets one `department-not-buildable` finding whose source record ID is the `DEPARTMENT_NUMBER`, whose value is the `DEPARTMENT` columns of the row, and whose message names the department and the unusable fields. It throws when the schema fails at a field `AGENCY_FIELD_WORDS` does not name.
- `transform.ts:buildAgencyPhoneNumbers` emits one record per non-blank `PHONE` and per non-blank `FAX` of a department whose agency was emitted, with `description` `Phone` or `Fax`. A department row is counted once, in `transform.ts:buildAgencies`.
- `transform.ts:buildPersonnel` does not emit an officer whose `FNAME` is blank or `null`: the row is counted as reported and gets one `officer-not-buildable` finding whose source record ID is the `PUBLIC_GUID`.
- `transform.ts:buildAgencyPersonnel` gives each `Services` row one outcome:
  - A row whose department or officer was left out is counted as reported and gets no finding of its own.
  - A row with a blank `ST_DATE` is counted as reported and gets one `service-not-buildable` finding whose source record ID is the AgencyPersonnel key.
  - Any other row is emitted and counted as emitted. `license_id` is the key of the officer's License. Every emitted record has `metadata.defects`: empty, or one `blank-appointment` finding when `APPOINTMENT` is blank and the title is set to `Unknown`.
- `transform.ts:buildLicensingAuthorities` emits a single record with `location_path_id` `tx` and `source_namespaces` holding `moduleSourceNamespace(import.meta.url)`. Its `metadata.defects` holds the findings for the left-out departments, then officers, then service rows, each in row order, and is an empty list when nothing was left out.
- `transform.ts:finding` builds every finding with type `warning`, source namespace `gov/texas/tcole`, and one evidence entry `{ workbook, sheet, row }`, where `workbook` is the file name of the workbook.
- `transform.ts:buildAuthorityLicenses` and `transform.ts:buildLicenses` read the rows of the `OfficersLicensesActions` sheet and then of the `Services` sheet. They emit one record per `transform.ts:authorityLicenseKey` and per `transform.ts:licenseHoldingKey`, only from rows whose officer was emitted. They count no rows.
- `transform.ts:buildLicenses` sets `status` and `first_awarded` from the `OfficersLicensesActions` rows of the holding:
  - A row with a blank `ACTION_DATE` is ignored for the status.
  - The status comes from the row with the latest `ACTION_DATE`; on a tie the later row wins.
  - A blank `LICENSE_STATUS` on that row does not replace a status set by an earlier row, so the status can come from an older action.
  - `first_awarded` is the first non-blank `DATE_AWARDED` in row order.
  - Both are null when no row supplies a value.
- `transform.ts:buildLicenseActions` emits one record per `OfficersLicensesActions` row whose officer was emitted and counts it as emitted. A row whose officer was left out is counted as reported and gets no finding of its own.
- `transform.ts:nullIfBlank` treats a blank value and the literal `null` in any letter case as null.

## Side Effects

- `transform.ts:transform` reads the workbook through the injected `readXlsx`; this module opens no file itself.
- `transform.ts:transform` and `transform.ts:buildAgencies` write progress, counts, and each omitted agency to the injected `logger`. `logger` is optional; without it the transform logs nothing. Left-out rows are reported by the findings and the accounting, not by the log.
- No network call, environment read, or child process.

## Verification

- Run: `npx vitest run test/sources/gov/texas/tcole/transform.test.ts`
