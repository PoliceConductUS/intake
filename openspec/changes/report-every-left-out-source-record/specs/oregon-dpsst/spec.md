## RENAMED Requirements

- FROM: `### Requirement: AgencyPersonnel represents active service`
- TO: `### Requirement: AgencyPersonnel represents service at the agency`

## MODIFIED Requirements

### Requirement: Deterministic source identities and truthful assignments

The transform SHALL emit existing import kinds only. DPSST numbers identify people,
agency codes identify agencies, and person plus agency plus actual hire date identify
employment episodes. Rank changes SHALL NOT create another employment episode.
A Hired or Transfered event opens an employment period. Provisionally, an Active event opens a period when none is open and otherwise updates the title without changing the start date. Explicit separation events close the period.
Events such as leave, promotion and reclassification SHALL NOT fabricate hire dates.
An episode without an explicit separation can be open only when the affiliation is
currently Active; an inactive affiliation with no known end SHALL be left out with a finding on the Oregon licensing authority.
Ambiguous duplicate hires and contradictory dates SHALL be reported rather than
resolved using guessed dates. An employment action the source does not map, in a row at an agency the transform builds, SHALL stop the transform, naming the page file, the row and the action; a row at an agency the transform leaves out is counted as reported under that agency's finding. Incomplete episodes remain in raw evidence.

#### Scenario: Rehire

- **WHEN** an officer is hired, separates, and is rehired at the same agency
- **THEN** emit two stable assignments keyed by their respective hire dates.

#### Scenario: Status change

- **WHEN** an officer is promoted
- **THEN** preserve the AgencyPersonnel identity and do not treat that event
  date as a hire or separation date.

#### Scenario: An action the source does not map

- **WHEN** an employment row at an agency the transform builds has an action that is not in the source's action map
- **THEN** the transform exits non-zero naming the page file, the row and the action

### Requirement: Use the shared intake boundary

The source SHALL keep network and filesystem acquisition separate from deterministic
transformation, emit source-local references through existing canonical artifact IO,
and use shared identity, field validation and property resolution during import.
It SHALL preserve all original responses. Every row it reads SHALL end in one outcome of `source-left-out-records`: emitted; left out with a finding on the Oregon licensing authority, or counted as reported under the finding of the agency or employment it depends on; counted as not selected under a named reason; or a stopped command. Where another requirement of this capability says that a row or an employment is reported, reported unresolved, or remains visibly unresolved or incomplete, it SHALL be left out with a finding on the Oregon licensing authority.

#### Scenario: Partial agency address

- **WHEN** an agency's page gives no city, state or ZIP code, so the agency fails the agency schema
- **THEN** retain the original response, emit no agency, and report one finding on the Oregon licensing authority naming the agency code; do not invent location data
  or introduce source-specific shared-pipeline corrections.

### Requirement: Reconstruct service only for available agencies

Employment history for an agency absent from emitted Agency records SHALL NOT enter AgencyPersonnel reconstruction. The transform SHALL report one finding on the Oregon licensing authority for each agency it cannot build (an agency code the agency lookup has no entry for, or an agency that fails the agency schema at its name, address, city, state or ZIP code), and SHALL count each employment row at such an agency as reported under that finding. An agency that fails the agency schema at another field SHALL stop the transform. An agency that is built but has no AgencyPersonnel after reconstruction SHALL NOT be emitted, nor its phone numbers, and SHALL be counted as not selected under `no AgencyPersonnel`. Raw history SHALL remain unchanged. Reconstruction issues for eligible agency history SHALL remain visible as findings, and existing AgencyPersonnel output eligibility checks SHALL remain in place.

#### Scenario: Out-of-state history without an identified agency

- **WHEN** Personnel has Out of State Employment history without an emitted Agency and service at an available named agency
- **THEN** only history for the available named agency enters AgencyPersonnel reconstruction
- **AND** the out-of-state history rows are counted as reported under the finding for the left-out agency, rather than producing artificial hire, promotion, or separation matching issues

### Requirement: AgencyPersonnel represents service at the agency

AgencyPersonnel SHALL represent service at the named agency, not uninterrupted employment. Its end date SHALL be the separation date when a separation follows, including a separation that follows a leave, and the leave date when the officer went on leave and no separation follows before a return. The source SHALL translate LOA, Mil-LOA, and LveNonCert as leave actions and Return LOA and Retrn MLOA as start actions. Root intake SHALL set the end date of an open AgencyPersonnel to the leave date and hold it as on leave until a start, a separation or the end of the history. Root intake SHALL start a new AgencyPersonnel on the return date. An AgencyPersonnel that ends on a separation after a leave includes the time on leave.

A separation that follows a leave at the same agency, with no return and no other start between them, SHALL end the AgencyPersonnel that is on leave on the separation date and not on the leave date: a separation after a leave is a real separation. It SHALL NOT be skipped and SHALL NOT require another hire. When the separation row gives a rank, that rank SHALL become the AgencyPersonnel's title, as it does for any separation. When one or more AgencyPersonnel at the agency are open, a separation SHALL apply among the open ones as "Concurrent employment periods" states. When no AgencyPersonnel at the agency is open and more than one is on leave, the separation SHALL apply only when its reported rank uniquely matches one of them; otherwise the separation row SHALL be left out with a finding on the Oregon licensing authority, and each AgencyPersonnel it could belong to SHALL stay emitted, ending on its leave date. A leave with no later separation SHALL leave the end date on the leave date. A change of rank or title while the officer is on leave, with no AgencyPersonnel at the agency open, SHALL attach to the AgencyPersonnel the leave paused, with no annotation.

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

### Requirement: Scheduled hires are skipped until their start date

The transform SHALL use an explicitly supplied UTC validation day. Hired events later than that day SHALL be skipped before employment reconstruction and counted as not selected under `scheduled hire`, with the personnel identity and date logged. A future Required certificate row associated with a skipped hire on the same date SHALL also be skipped and counted under `scheduled hire`. Raw evidence SHALL remain unchanged and no persistent exclusion SHALL be written. Other future dates SHALL remain subject to shared date validation.

#### Scenario: Hire becomes eligible

- **WHEN** the same source evidence is transformed before its hire date
- **THEN** the scheduled hire and its associated future Required certificate row are skipped and counted under `scheduled hire`
- **WHEN** it is transformed on or after that date
- **THEN** those rows are eligible for normal transformation without removing an exclusion

## ADDED Requirements

### Requirement: An employment finding keeps its source record ID when events are added

A finding about an employment row SHALL have the source record ID `officer-<DPSST number>-employment#<row>`, where `<row>` is the row's number in the officer's employment history counted from the oldest event: the last data row of the last employment page is 1, and the count runs through every page. The ID SHALL NOT hold a page file name, a command folder or a time. The finding's evidence SHALL give the page file and the row's number from the top of that page.

#### Scenario: A newer event is added at the top

- **WHEN** an officer's employment history gains one newer event at the top and is transformed again
- **THEN** every finding about an earlier row has the same source record ID as before

#### Scenario: A newer event moves a row to the next page

- **WHEN** the newer event moves the last row of the first employment page to the second page
- **THEN** every finding about an earlier row has the same source record ID as before

### Requirement: A finding about a whole employment uses the row that started it

A finding about a whole employment SHALL have the source record ID of the row that started that employment, numbered as for an employment row.

#### Scenario: A finding about a whole employment

- **WHEN** an employment that started on the officer's third-oldest row has no end date and the officer is not shown as active at the agency
- **THEN** the employment is left out with one finding whose source record ID is `officer-<DPSST number>-employment#3`
