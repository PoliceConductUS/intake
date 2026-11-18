## MODIFIED Requirements

### Requirement: AgencyPersonnel represents active service

AgencyPersonnel SHALL represent active service at the named agency, not uninterrupted employment. The source SHALL translate LOA, Mil-LOA, and LveNonCert as leave actions and Return LOA and Retrn MLOA as start actions. Root intake SHALL close active AgencyPersonnel on the leave date and start new AgencyPersonnel on the return date.

A separation that follows a leave at the same agency, with no return and no other start between them, SHALL end that AgencyPersonnel on the separation date and not on the leave date. It SHALL NOT be skipped and SHALL NOT require another hire. When more than one AgencyPersonnel is on leave at the agency, the separation SHALL apply only when its reported rank uniquely matches one of them; otherwise the affected AgencyPersonnel SHALL be reported unresolved. A leave with no later separation SHALL leave the end date on the leave date.

A separation after an earlier separation, and a leave while the officer is on leave or after the employment ended, with no start between them, SHALL NOT change any AgencyPersonnel. Each SHALL be counted as not selected under its own reason: `separation after separation` and `leave while not in active service`.

#### Scenario: Transfer during leave and later return

- **GIVEN** Coffee Creek LOA on 2017-01-17 and DOC-Transf on 2017-08-21
- **THEN** Coffee Creek AgencyPersonnel ends 2017-08-21
- **WHEN** Santiam has Return LOA on 2017-08-22, LOA on 2019-10-29, Return LOA on 2020-05-18, and Retired on 2026-01-30
- **THEN** Santiam has separate AgencyPersonnel records for 2017-08-22 through 2019-10-29 and 2020-05-18 through 2026-01-30

#### Scenario: Separation during leave

- **WHEN** an officer is Hired on 2020-01-01, has LOA on 2020-02-01 and Resigned on 2020-03-01 at one agency
- **THEN** one AgencyPersonnel record runs from 2020-01-01 through 2020-03-01
- **AND** the resignation row is counted as emitted

#### Scenario: Return from leave before the separation

- **WHEN** an officer is Hired on 2020-01-01, has LOA on 2020-02-01, Return LOA on 2020-03-01 and Resigned on 2020-04-01 at one agency
- **THEN** there are two AgencyPersonnel records, 2020-01-01 through 2020-02-01 and 2020-03-01 through 2020-04-01

#### Scenario: Leave with no later event

- **WHEN** an officer is Hired on 2020-01-01 and has LOA on 2020-02-01 with no later event at the agency
- **THEN** one AgencyPersonnel record runs from 2020-01-01 through 2020-02-01

#### Scenario: A second separation

- **WHEN** an officer is Hired on 2020-01-01, Resigned on 2020-02-01 and Resigned again on 2020-03-01 at one agency
- **THEN** one AgencyPersonnel record runs from 2020-01-01 through 2020-02-01
- **AND** the second resignation is counted as not selected under `separation after separation`

## ADDED Requirements

### Requirement: An employment finding keeps its source record ID when events are added

A finding about an employment row SHALL have the source record ID `officer-<DPSST number>-employment#<row>`, where `<row>` is the row's number in the officer's employment history counted from the oldest event: the last data row of the last employment page is 1, and the count runs through every page. The ID SHALL NOT hold a page file name, a command folder or a time. The finding's evidence SHALL give the page file and the row's number from the top of that page.

#### Scenario: A newer event is added at the top

- **WHEN** an officer's employment history gains one newer event at the top and is transformed again
- **THEN** every finding about an earlier row has the same source record ID as before

#### Scenario: A newer event moves a row to the next page

- **WHEN** the newer event moves the last row of the first employment page to the second page
- **THEN** every finding about an earlier row has the same source record ID as before
