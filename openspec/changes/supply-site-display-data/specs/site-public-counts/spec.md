## ADDED Requirements

### Requirement: Public counts are defined by database views

Every count the site shows SHALL come from one of these views: `site_agency_count`, `site_location_count`, `site_personnel_count`, `site_personnel_state_count`, `site_federal_agency_count` and `site_licensing_authority_count`. Every count SHALL be a count of distinct records. Employment status in these views SHALL come from `site_agency_personnel_employment`.

#### Scenario: Same count on two pages

- **WHEN** an agency's current staff count appears on its agency page and on its place page
- **THEN** both come from `site_agency_count.current_personnel_count`

### Requirement: Staff counts use employment status

A current staff count SHALL count distinct `personnel_id` values with an `agency_personnel` row whose `site_agency_personnel_employment.employment_status` is `Current`. A location's count SHALL count each person once across all agencies within it. `site_agency_count` SHALL also give `current_assignment_count`, the number of `Current` `agency_personnel` rows.

#### Scenario: Person at two agencies in one place

- **WHEN** one person has `Current` assignments at two agencies in the same place
- **THEN** each agency counts the person once and the place counts the person once

#### Scenario: Agency count with two current rows for one person

- **WHEN** one person has two `Current` `agency_personnel` rows at the same agency
- **THEN** that agency's `current_assignment_count` is 2 and its `current_personnel_count` is 1

### Requirement: The personnel state map counts each listed person once

`site_personnel_state_count.listed_personnel_count` SHALL count each person once, under the state of the agency on the person's latest-started `Current` row (`start_date` descending, nulls last, then `id` descending), when that agency has an agency page. It SHALL NOT count a person under every state where the person has an assignment.

#### Scenario: Person with current rows in two states

- **WHEN** a person has a `Current` row at a Texas agency that started in 2018 and a `Current` row at an Oklahoma agency that started in 2021
- **THEN** the person counts once, under Oklahoma, and not under Texas

### Requirement: Civil case counts follow the scope rules

`site_personnel_count.civil_case_count` SHALL count cases linked to any of the person's `agency_personnel` rows. `site_agency_count.civil_case_count` SHALL count cases linked to that agency's own `agency_personnel` rows only. `site_location_count.civil_case_count` SHALL count cases linked to the `agency_personnel` rows of every agency located within the location through `location_path_closure`. No count SHALL use `civil_cases.location_path_id`.

#### Scenario: Case from another job

- **WHEN** a case links a person's assignment at agency B and the person also works at agency A
- **THEN** agency A's civil case count does not include the case

### Requirement: Report, discipline and license counts come from stored links

Report counts SHALL count distinct `reviews` by `reviews.agency_id` for an agency and by `reviews.location_path_id` within a location. Discipline counts SHALL count distinct `discipline` rows from any source. License action discipline counts SHALL count license actions whose type has category `discipline`.

#### Scenario: Discipline from two sources

- **WHEN** a person has one discipline row from MN POST and one from a curated source
- **THEN** `site_personnel_count.discipline_count` is 2
