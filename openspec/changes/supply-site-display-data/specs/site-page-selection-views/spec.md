## ADDED Requirements

### Requirement: Page selection is defined by database views

An intake migration SHALL define these views, and each SHALL hold one page-selection rule: `site_agency_page`, `site_location_page`, `site_personnel_page`, `site_personnel_listing`, `site_federal_agency_branch`, `site_report_page`, `site_civil_case_page` and `site_topic_page`. A rule that tests "current" SHALL use `agency_personnel.employment_status = 'Current'`.

#### Scenario: Agency with only former staff

- **WHEN** every `agency_personnel` row of an agency has `employment_status` `Former`
- **THEN** `site_agency_page` has no row for it

#### Scenario: Person with an assignment

- **WHEN** a person has one `Former` assignment
- **THEN** `site_personnel_page` has a row for the person and `site_personnel_listing` does not

#### Scenario: Topic page with no records

- **WHEN** a place has zero reports
- **THEN** `site_topic_page` has no `reports` row for that place

### Requirement: Location pages carry their hierarchy

`site_location_page` SHALL return, for each state, area and place that contains a `site_agency_page` agency, its parent paths from `parent_location_path_id`, its path segments, and its only child agency or place when it has exactly one. `site_agency_page` SHALL require a place under an `administrative_area` row under a `state` row.

#### Scenario: Place with one agency

- **WHEN** a place contains exactly one agency page
- **THEN** its `site_location_page` row names that agency as its only child

### Requirement: Reports use their stored agency and path

`site_report_page` SHALL return each report's canonical path `/{state}/{area}/{place}/reports/{year}/{month}/{day}/{slug}/` from the stored location path, the UTC date of `incident_date` and the slug, and its agency from `reviews.agency_id`.

#### Scenario: Report page row

- **WHEN** a report has location `/tx/dallas-county/irving/`, incident date 2025-03-04 and slug `traffic-stop`
- **THEN** its path is `/tx/dallas-county/irving/reports/2025/03/04/traffic-stop/`

### Requirement: Foreign-key chains are views

The chains the site follows SHALL be views over recorded foreign keys. `site_agency_staff_other_civil_case` SHALL return, for an agency, the civil cases linked through `civil_case_personnel` to other `agency_personnel` rows of personnel who have an assignment at that agency, with the other assignment's agency.

#### Scenario: Officer sued at a former employer

- **WHEN** a person works at agency A and a civil case links the person's earlier assignment at agency B
- **THEN** the view returns that case for agency A with agency B as the other assignment's agency

### Requirement: The personnel headline assignment is a database view

`site_personnel_headline_assignment` SHALL return one row for each person with at least one `agency_personnel` row, naming one of that person's `agency_personnel` rows and its `headline_basis`, using the employment status from `site_agency_personnel_employment`. The website SHALL name the person's agency only from this view.

#### Scenario: Person with an ended and a current assignment

- **WHEN** a person has a `Former` row that started in 2021 and a `Current` row that started in 2015
- **THEN** the view names the `Current` row with `headline_basis` `Current`

#### Scenario: Person with an uncertain assignment and no current one

- **WHEN** a person has a `Former` row that started in 2010 and an `Unknown` row that started in 2016
- **THEN** the view names the `Unknown` row with `headline_basis` `Recorded`

#### Scenario: Person whose assignments all ended

- **WHEN** a person has a `Former` row that ended in 2015 and a `Former` row that started later but ended in 2012
- **THEN** the view names the row that ended in 2015 with `headline_basis` `Most recent`

### Requirement: The headline assignment rule

`headline_basis` SHALL be `Current` when the person has a `Current` row, else `Recorded` when the person has an `Unknown` row, else `Most recent`. The named row SHALL be the latest-started `Current` row for `Current`, the latest-started row for `Recorded`, and the row with the latest end date, then the latest start date, for `Most recent`. An absent start date SHALL sort first; remaining ties SHALL go to the greatest `id`.

#### Scenario: Two current rows with the same start date

- **WHEN** a person has two `Current` rows that both started in 2020
- **THEN** the view names the row with the greater `id`
