## ADDED Requirements

### Requirement: Public counts are defined by database views

Every count the site shows SHALL come from one of these views: `site_agency_count`, `site_location_count`, `site_personnel_count`, `site_federal_agency_count` and `site_licensing_authority_count`. Every count SHALL be a count of distinct records.

#### Scenario: Same count on two pages

- **WHEN** an agency's current staff count appears on its agency page and on its place page
- **THEN** both come from `site_agency_count.current_personnel_count`

### Requirement: Staff counts use employment status

A current staff count SHALL count distinct `personnel_id` values with an `agency_personnel` row whose `employment_status` is `Current`. A location's count SHALL count each person once across all agencies within it.

#### Scenario: Person at two agencies in one place

- **WHEN** one person has `Current` assignments at two agencies in the same place
- **THEN** each agency counts the person once and the place counts the person once

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
