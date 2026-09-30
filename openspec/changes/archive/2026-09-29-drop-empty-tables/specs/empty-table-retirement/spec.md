## ADDED Requirements

### Requirement: Remove the audited empty tables

The migrated public schema SHALL omit `agency_links`,
`coverage_link_civil_cases`, `coverage_link_reports`, `federal_agency_branch`,
`location_report_sources`, `location_reports`, `review_attachments`,
`review_tags`, `review_witnesses`, and `tags`.

#### Scenario: Apply the removal migration

- **WHEN** the migration is applied to the current intake schema
- **THEN** all ten named tables SHALL be absent
- **AND** all other application tables and their records SHALL remain unchanged

#### Scenario: Build a fresh schema

- **WHEN** all checked-in migrations are applied to a fresh database
- **THEN** the final schema SHALL omit the same ten tables

### Requirement: Retire intake support for removed tables

Intake SHALL remove `AgencyLink`, `FederalAgencyBranch`, and
`CoverageLinkCivilCase` from its models, generated contracts, manual choices,
source outputs, graph edges, and resolvers.

#### Scenario: Run remaining multi-output sources

- **WHEN** federal-agency and PoliceActivity transformations run
- **THEN** they SHALL emit their retained federal-agency, agency, coverage-link,
  and personnel-link records without emitting the retired record kinds

#### Scenario: Read a retired artifact kind

- **WHEN** an artifact declares a retired record kind
- **THEN** the canonical artifact reader SHALL reject it
