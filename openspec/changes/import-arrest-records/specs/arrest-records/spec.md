## ADDED Requirements

### Requirement: One arrest row per booking

Intake SHALL store one `arrest` row per distinct source booking number, with `agency_id`, `booking_number`, `arrest_date`, `arrest_time`, `source_district`, beat, beat status, income status, `source_row_count` and every other field the source supplies. The row ID SHALL come from the source-name mapping with the booking number as source ID.

#### Scenario: Booking repeated on two source rows

- **WHEN** a booking appears on two `Arrest Data` rows
- **THEN** intake stores one `arrest` row with `source_row_count` 2

#### Scenario: Booking without charges

- **WHEN** a booking has no matching `Charges` row
- **THEN** its `arrest` row is stored and counted

### Requirement: Every publicly released field is imported

Intake SHALL store every field of a publicly released arrest record, including the arrestee's name, home address, home ZIP, home coordinates, residential tract, booking number, arrest location and arrest coordinates. A field the agency redacted SHALL be stored as the release shows it and SHALL NOT be filled from another file, a guess or a join. Source files and record values SHALL stay out of the repository.

#### Scenario: Workbook with booking name and address

- **WHEN** the workbook supplies a booking name and `Booking_Address`
- **THEN** the arrest row holds `arrestee_name` and `arrestee_home_address` as the source wrote them

#### Scenario: Redacted field

- **WHEN** the release shows a field as redacted
- **THEN** the arrest row holds the value as released and no other input fills it

### Requirement: Website build reads only arrest counts and breakdowns

The website build SHALL read arrest data only through `arrest_coverage`, `arrest_breakdown`, `police_beat`, `census_tract_household_income`, `household_income_band` and the arrest annotations, to show the counts and breakdowns the site already shows. It SHALL NOT read or publish any other field of `arrest`, `arrest_charge`, `arrest_offense` or `arrest_agency_personnel`. Publishing any other arrest-record field SHALL require a new OpenSpec change.

#### Scenario: Arrestee name in the database

- **WHEN** an `arrest` row holds an arrestee's name, home address and booking number
- **THEN** the website build reads none of them and no built page contains them

#### Scenario: Proposal to show booking numbers

- **WHEN** someone wants a page to show booking numbers
- **THEN** that work starts with a new OpenSpec change before any website code reads `arrest.booking_number`

### Requirement: One row per charge and offense row

Intake SHALL store one `arrest_charge` row per source charge row and one `arrest_offense` row per source offense row, each linked to its arrest, keeping exact source text. Exact repeated source rows SHALL stay separate rows. No charge SHALL be chosen as primary.

#### Scenario: Three charges with one exact repeat

- **WHEN** a booking has three charge rows and two are identical
- **THEN** intake stores three `arrest_charge` rows for that arrest

### Requirement: Resolved officers are recorded links

For each source officer name that resolves to an `agency_personnel` row at the arresting agency, intake SHALL store an `arrest_agency_personnel` row with the source name as written. A booking MAY have several such rows.

#### Scenario: Two officers on one booking

- **WHEN** a booking names two officers who both resolve
- **THEN** intake stores two `arrest_agency_personnel` rows for that arrest

### Requirement: Arrests without an identified officer are annotated

An arrest with no officer name SHALL get an annotation with code `arrest_officer_not_identified`. Each officer name that does not resolve SHALL give the arrest an annotation with code `arrest_officer_not_matched` holding the name. A booking with no linked charge row SHALL get an annotation with code `arrest_without_charge_records` whose message does not say that no charge existed.

#### Scenario: Name not on the roster

- **WHEN** a booking's officer name matches no Irving roster entry
- **THEN** the arrest is stored with its agency, no `arrest_agency_personnel` row is stored for that name, and an annotation holds the name

#### Scenario: Booking names no officer

- **WHEN** a booking has no officer name
- **THEN** the arrest is stored with its agency and an annotation with code `arrest_officer_not_identified`

### Requirement: Employee and badge numbers identify officers when supplied

`agency_personnel.employee_number` SHALL hold an agency's internal employee number, unique within the agency. `agency_personnel_badge` SHALL hold one row per badge number an `agency_personnel` row held, with start and end dates when the source gives them. Both SHALL be filled only from a source that maps numbers to named personnel. Intake SHALL NOT infer a number.

#### Scenario: Roster arrives

- **WHEN** a roster source maps employee number 1234 and badge number 567 to a named Irving officer
- **THEN** that officer's Irving `agency_personnel` row holds `employee_number` 1234 and has an `agency_personnel_badge` row with `badge_number` 567

#### Scenario: Badge history

- **WHEN** the roster lists an earlier badge number with the dates it was used
- **THEN** the officer has one `agency_personnel_badge` row per badge number, each with its dates

#### Scenario: Duplicate number

- **WHEN** two Irving `agency_personnel` rows would hold the same employee number
- **THEN** generation fails naming both rows

### Requirement: Reference rows for beats and income

Intake SHALL store official beat polygons in `police_beat`, ACS tract income in `census_tract_household_income`, and income band labels and limits in the manual-records table `household_income_band`. Arrest rows SHALL link to a beat by foreign key.

#### Scenario: Topcoded tract

- **WHEN** a tract's ACS estimate is topcoded at 250000
- **THEN** its row holds `topcoded` true

### Requirement: Views replace the arrest aggregate tables

The views `arrest_coverage` and `arrest_breakdown` SHALL give every measure the dropped `arrest_profile` and `agency_arrest_profile` tables held, per agency and per `agency_personnel`. Agency figures SHALL come from all the agency's bookings and SHALL NOT be sums of officer figures.

#### Scenario: Agency total with unresolved bookings

- **WHEN** an agency has 100 bookings and 60 are linked to resolved officers
- **THEN** `arrest_coverage` reports 100 bookings for the agency
