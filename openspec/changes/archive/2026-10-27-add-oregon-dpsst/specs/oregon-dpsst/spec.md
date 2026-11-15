## ADDED Requirements

### Requirement: Preserve and enumerate public source evidence

The source SHALL acquire all pages for each configured name prefix (A-Z by default),
retain unchanged HTML, deduplicate officer/agency affiliations by source identity,
and fetch each officer's employment and certification pages and linked agencies.
It SHALL distinguish a targeted prefix run from statewide coverage. It SHALL NOT
claim a complete acquisition on transport, parse, session or pagination failure.

#### Scenario: Search and detail pagination

- **WHEN** a public search or detail table has another page
- **THEN** acquisition follows its actual postback and retains every page.

#### Scenario: Public session expires

- **WHEN** the site redirects a request to its own public Logout page
- **THEN** acquisition opens and validates the public search form and retries that request once
- **AND** logs the renewal and fails on another redirect or any unrelated redirect.

#### Scenario: Missing agency

- **WHEN** the source explicitly responds No Data Found
- **THEN** preserve the response and report the agency as unavailable without
  inventing an address or emitting dangling assignment references.

#### Scenario: Agency lookup returns multiple rows

- **WHEN** an agency lookup returns multiple rows
- **THEN** select the unique row whose exact name matches the roster affiliation
- **AND** fail if the matching identity is missing or ambiguous.

#### Scenario: Resume interrupted statewide acquisition

- **WHEN** the CLI supplies a prior interrupted acquisition for the same prefixes
- **THEN** validate and reuse complete search prefixes, officer detail sets and agency responses
- **AND** fetch incomplete units again, preserving the prior command's raw evidence
- **AND** reject malformed saved identities, page sequences or a different prefix scope.

### Requirement: Deterministic source identities and truthful assignments

The transform SHALL emit existing import kinds only. DPSST numbers identify people,
agency codes identify agencies, and person plus agency plus actual hire date identify
employment episodes. Rank changes SHALL NOT create another employment episode.
A Hired or Transfered event opens an employment period. Provisionally, an Active event opens a period when none is open and otherwise updates the title without changing the start date. Explicit separation events close the period.
Events such as leave, promotion and reclassification SHALL NOT fabricate hire dates.
An episode without an explicit separation can be open only when the affiliation is
currently Active; an inactive affiliation with no known end is reported unresolved.
Ambiguous duplicate hires, contradictory dates or unknown actions SHALL be reported
rather than resolved using guessed dates. Incomplete episodes remain in raw evidence.

#### Scenario: Rehire

- **WHEN** an officer is hired, separates, and is rehired at the same agency
- **THEN** emit two stable assignments keyed by their respective hire dates.

#### Scenario: Status change

- **WHEN** an officer is promoted
- **THEN** preserve the AgencyPersonnel identity and do not treat that event
  date as a hire or separation date.

### Requirement: Preserve certification meaning

Each distinct certificate type plus level SHALL identify an authority license.
Each person/type holding SHALL retain the source status and certificate award date.
The dated status SHALL be emitted as a license action. Expiration/probation dates
remain in raw evidence because the current license contract has no corresponding
fields. Certification status SHALL NOT substitute for employment status.

#### Scenario: Revoked certification

- **WHEN** a certificate is revoked with a source status date
- **THEN** emit the holding and the dated revocation without inferring employment
  termination or an allegation.

### Requirement: Use the shared intake boundary

The source SHALL keep network and filesystem acquisition separate from deterministic
transformation, emit source-local references through existing canonical artifact IO,
and use shared identity, field validation and property resolution during import.
It SHALL preserve all original responses and log every record omission and reason.

#### Scenario: Partial agency address

- **WHEN** an agency has insufficient address data
- **THEN** retain the original response and report it; do not invent location data
  or introduce source-specific shared-pipeline corrections.

### Requirement: Apply provisional employment action interpretations

The transform SHALL apply the user-supplied provisional interpretations using exact source labels, pending DPSST confirmation. Inactive, InactiveAG, Deceased, Terminated, and Rtrd Disab SHALL close an existing employment period, alongside existing separation actions. Prob Dschg means probationary discharge and remains a separation.

DPSSTRecla SHALL continue existing active service and retain its original start date. DPSSTRecla represents a change to title, duties, or salary tier for certification requirements. LveNonCert represents leave involving a non-certified position or uncertified employee. Retrn MLOA represents return from military leave.

InstrApp represents an internal instructor application and SHALL be omitted from employment reconstruction for now, while preserving its raw source rows. It SHALL NOT establish or end employment, change titles, require agency resolution, or introduce same-day employment ordering ambiguity. Transfered SHALL open employment at the receiving agency or institution named on the row using that row's date. DOC-Transf SHALL close employment at the departing agency or institution named on its row using its date. Neither event SHALL manufacture a corresponding event for another agency. The exact source spelling Transfered SHALL be preserved. Reinstated SHALL represent restored agency employment: it opens an employment period on its date when none is open, or continues the existing period and updates its title when a rank is supplied. It SHALL NOT undo a recorded separation or change a prior start date. Certificate status alone SHALL NOT be treated as separation.

#### Scenario: Active starts or updates employment

- **WHEN** an Active action is encountered
- **THEN** it starts employment on that date if no period is open, or updates the title of the existing period without changing its start date

#### Scenario: Inactive ends employment

- **WHEN** Inactive or InactiveAG follows an open employment period
- **THEN** the period ends on that event date

#### Scenario: Leave or reinstated certification continues employment

- **WHEN** a recognized continuation follows a known employment start
- **THEN** the original start date is retained and the event rank updates the title when supplied
- **AND** a continuation without a known start remains visibly unresolved

Cert Riens is provisionally interpreted as certification reinstatement. Its exact source spelling SHALL be preserved; the importer SHALL NOT assert that it is an OCR error.

CertRevoke represents certification revocation, not an employment separation. Its code alone SHALL NOT establish misconduct grounds or an ineligibility period.

CertSuspnd represents certification suspension. Its code alone SHALL NOT establish a reason for suspension, employment separation, or title change.

#### Scenario: Certification actions are not employment events

- **WHEN** employment history contains CertDenied, Cert Riens, CertRevoke, or CertSuspnd
- **THEN** it does not open, close, or change the title of an employment period, or introduce same-day employment ordering ambiguity
- **AND** the raw event remains preserved without inferring the reason for denial or an employment separation

#### Scenario: Transfer departure and arrival establish separate agency assignments

- **WHEN** DOC-Transf follows a known employment start at the named agency
- **THEN** that employment period ends on the transfer date
- **AND** a separate receiving agency Transfered event starts its own employment period on the arrival date
- **AND** a DOC-Transf departure with no known employment start remains visibly incomplete

#### Scenario: Employment reinstatement after separation or leave

- **WHEN** Reinstated follows a recorded separation
- **THEN** a new employment period starts on the reinstatement date and the earlier period remains unchanged
- **WHEN** Reinstated follows leave that ended active service
- **THEN** new AgencyPersonnel starts on the reinstatement date with the supplied title
- **WHEN** Reinstated is the first known employment action
- **THEN** it starts employment on that date without inventing earlier service

### Requirement: Scheduled hires are skipped until their start date

The transform SHALL use an explicitly supplied UTC validation day. Hired events later than that day SHALL be skipped before employment reconstruction, with the personnel identity and date logged. A future Required certificate row associated with a skipped hire on the same date SHALL also be skipped. Raw evidence SHALL remain unchanged and no persistent exclusion SHALL be written. Other future dates SHALL remain subject to shared date validation.

#### Scenario: Hire becomes eligible

- **WHEN** the same source evidence is transformed before its hire date
- **THEN** the scheduled hire and its associated future Required certificate row are skipped
- **WHEN** it is transformed on or after that date
- **THEN** those rows are eligible for normal transformation without removing an exclusion

### Requirement: Concurrent employment periods

Root intake SHALL own the pure employment reconstruction stage. Sources SHALL normalize their date formats and action labels into typed employment events; the root stage SHALL determine event matching, concurrency, and episode completeness without source namespace or source-ID special cases. Employment reconstruction SHALL permit multiple open periods under the same source agency label. A new explicit hire or transfer arrival SHALL open its own period without invalidating another period. When multiple periods are open, a separation or continuation SHALL apply only when its reported rank uniquely matches one period's current title. Otherwise the affected periods SHALL be reported unresolved without choosing by chronological position or fabricating an end date. This matching does not identify an employer hidden behind an aggregate source label. Existing single-period title changes and cross-agency concurrency SHALL remain supported.

#### Scenario: Overlapping positions under one label

- **WHEN** Police Officer employment starts on 2015-01-12 and Deputy Sheriff employment starts on 2017-06-19 under the same label
- **AND** the Police Officer resigns on 2017-06-30 and the Deputy Sheriff resigns on 2018-10-31
- **THEN** reconstruction retains both periods with their respective dates and positions
- **AND** does not report a repeated-hire conflict or separation without hire

#### Scenario: Indistinguishable concurrent periods

- **WHEN** multiple open periods match a separation's position
- **THEN** reconstruction reports ambiguous matching and does not invent which period ended or publish the affected periods as currently employed

### Requirement: AgencyPersonnel represents active service

AgencyPersonnel SHALL represent active service at the named agency, not uninterrupted employment. The source SHALL translate LOA, Mil-LOA, and LveNonCert as end actions and Return LOA and Retrn MLOA as start actions. Root intake SHALL close active AgencyPersonnel on the leave date and start new AgencyPersonnel on the return date. A subsequent separation while already inactive SHALL NOT extend the preceding active period or require another hire.

#### Scenario: Transfer during leave and later return

- **GIVEN** Coffee Creek LOA on 2017-01-17 and DOC-Transf on 2017-08-21
- **THEN** Coffee Creek active service ends 2017-01-17
- **WHEN** Santiam has Return LOA on 2017-08-22, LOA on 2019-10-29, Return LOA on 2020-05-18, and Retired on 2026-01-30
- **THEN** Santiam has separate AgencyPersonnel records for 2017-08-22 through 2019-10-29 and 2020-05-18 through 2026-01-30

### Requirement: Preserve source employment sequence

DPSST employment history SHALL be traversed bottom-to-top in its acquired sequence across all pages. The source adapter SHALL supply that sequence to root reconstruction. Root reconstruction SHALL NOT sort events by date, action, or other fields. Distinct events sharing a date SHALL follow that sequence without being rejected solely for sharing a date.

#### Scenario: Same-day hire and title change

- **WHEN** the source displays Reclassed to Supervisor above Hired as Dispatcher, both on 2022-04-18
- **THEN** reconstruction processes the hire followed by the reclassification and retains AgencyPersonnel starting 2022-04-18 with title Supervisor

### Requirement: Reconstruct service only for available agencies

Employment history for an agency absent from emitted Agency records SHALL NOT enter AgencyPersonnel reconstruction. The transform SHALL report the missing agency and count of retained source rows per Personnel and source agency name. Raw history SHALL remain unchanged. Reconstruction issues for eligible agency history SHALL remain visible, and existing AgencyPersonnel output eligibility checks SHALL remain in place.

#### Scenario: Out-of-state history without an identified agency

- **WHEN** Personnel has Out of State Employment history without an emitted Agency and service at an available named agency
- **THEN** only history for the available named agency enters AgencyPersonnel reconstruction
- **AND** the out-of-state history produces a missing-agency omission with its source-row count, rather than artificial hire, promotion, or separation matching issues
