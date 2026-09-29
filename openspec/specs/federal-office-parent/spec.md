# federal-office-parent Specification

## Purpose
TBD - created by archiving change federal-agency-office-parent. Update Purpose after archive.
## Requirements
### Requirement: Federal offices are ordinary agencies with one parent

Agency SHALL have a nullable `parent_federal_agency_id` foreign key referencing
FederalAgency. Each office SHALL retain its ordinary Agency identity, slug, and
location path. The federal agency page's branch data SHALL be the agencies whose
parent reference identifies that federal agency; offices SHALL also remain
available under ordinary place URLs. The former FederalAgencyBranch table and
envelope SHALL remain retired.

#### Scenario: Office belongs to a federal organization

- **WHEN** the federal source emits a complete office for a known organization
- **THEN** it emits an Agency with `parent_federal_agency_id` set to the parent
  source name, resolved to its canonical FederalAgency ID before database writing
- **AND** an existing office retains its canonical Agency ID and slug

#### Scenario: Agency has no federal parent

- **WHEN** an ordinary agency has no federal parent
- **THEN** its parent field is null and its existing behavior is unchanged

#### Scenario: Rebuild and import the preserved federal source

- **WHEN** the migration chain and the preserved 11-office federal source are applied
- **THEN** all 11 offices have valid parent foreign keys on their Agency rows
- **AND** no separate branch relationship rows are required

