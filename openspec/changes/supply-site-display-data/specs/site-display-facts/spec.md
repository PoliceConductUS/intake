## ADDED Requirements

### Requirement: Assignments store an employment status

Every `agency_personnel` row SHALL hold `employment_status`, one of `Current`, `Former` or `Unknown`, set by intake's documented rule and cached as a resolved property. `Former` SHALL mean the assignment has an `end_date`. `Current` SHALL mean no `end_date` and a source that lists currently employed officers has listed the assignment. Every other case SHALL be `Unknown`. Each source SHALL document which input is a current roster.

#### Scenario: A later list omits the assignment

- **WHEN** a source that lists currently employed officers listed an assignment before, and its newest list omits it with no end date
- **THEN** intake changes nothing on that assignment, because the omission does not say what happened (owner, 2026-11-22)

#### Scenario: Ended assignment

- **WHEN** a source supplies an assignment with `end_date` 2019-04-30
- **THEN** its `employment_status` is `Former`

#### Scenario: Current roster entry

- **WHEN** the latest TCOLE current-appointments snapshot lists an assignment with no end date
- **THEN** its `employment_status` is `Current`

#### Scenario: No end date from a source that is not a current roster

- **WHEN** a source that is not a current roster supplies an assignment with no end date
- **THEN** its `employment_status` is `Unknown`

### Requirement: Assignment dates hold the effective value

Intake SHALL write an assignment's effective start and end dates into `agency_personnel.start_date` and `agency_personnel.end_date`. The site SHALL NOT need `data_source_values` to find a date. When a source supplies a date only as text that cannot be parsed, the column SHALL stay null and the validation annotation SHALL keep the original text.

#### Scenario: Unparseable end date

- **WHEN** a source supplies end date text `unk`
- **THEN** `end_date` is null, `employment_status` is not `Current`, and an annotation records `unk`

### Requirement: Reports store their agency

Every `reviews` row SHALL hold `agency_id`, a foreign key to `agency`, set from the report's own source. Intake SHALL NOT take the agency from a `review_personnel` row.

#### Scenario: Report naming officers at two agencies

- **WHEN** a curated report names the agency Irving PD and links officers at Irving PD and Dallas PD
- **THEN** `reviews.agency_id` is the Irving PD agency ID

#### Scenario: Report without an agency

- **WHEN** a report source supplies no agency
- **THEN** generation fails and names the report

### Requirement: Civil cases store a status

Every `civil_cases` row SHALL hold `status`, one of `Open`, `Closed` or `Unknown`. Intake SHALL set `Closed` when the source reports a termination date or a final outcome, `Open` only when the source states the case is pending, and `Unknown` otherwise.

#### Scenario: Docket with no termination and no pending statement

- **WHEN** a CourtListener docket has no termination date and the source does not state the case is pending
- **THEN** the case `status` is `Unknown`

### Requirement: Agency phone numbers store their kind

Every `agency_phone_numbers` row SHALL hold `kind`, `Phone` or `Fax`, set from the source's own label. No order or primary flag SHALL be added, because no page needs one.

#### Scenario: Fax number

- **WHEN** a source labels a number as a fax number
- **THEN** its `kind` is `Fax`

### Requirement: State and area locations store their codes and kinds

A `location_path` row with `level = 'state'` SHALL hold `state_code`, the USPS code supplied by the Census source. A row with `level = 'administrative_area'` SHALL hold `administrative_area_kind_id`, a foreign key to the manual-records table `administrative_area_kind` (`name`, `plural_name`). Other rows SHALL hold null in both columns.

#### Scenario: Louisiana parish

- **WHEN** the Census source supplies a Louisiana parish
- **THEN** its `administrative_area_kind_id` names the kind with `name` `Parish` and `plural_name` `Parishes`

#### Scenario: State row

- **WHEN** the Census source supplies Texas
- **THEN** its `state_code` is `TX`

### Requirement: Deceased personnel have a stored message

A `personnel` row with `deceased_on` or `deceased_source` SHALL hold a nonblank `deceased_message` written by intake. A database check SHALL enforce it.

#### Scenario: Death reported with a date

- **WHEN** a source reports a death on 2024-02-01
- **THEN** the row holds `deceased_message` and the site generates no notice text of its own
