## MODIFIED Requirements

### Requirement: Shared directed inclusion graph

Intake SHALL declare the inclusion edges as shared metadata and traverse them only in their declared direction. Agency descendants include assignments, personnel, licenses, license actions, agency contacts, assignment-linked cases, reviews, disciplines, coverage, arrests and their charge, offense and officer rows, police beats, and their evidence links. Traversal SHALL NOT expand through shared cases or personnel into other assignments or through reference data into unrelated records; federal organizations SHALL traverse only their office Agency relationships and the ordinary directed descendants of those offices. Explicitly excluded records SHALL remain excluded. Selected records SHALL NOT retain a required reference to a deliberately unselected candidate.

#### Scenario: Case references two agencies

- **WHEN** a civil case links assignments at two agencies, including an agency with only historical assignments
- **THEN** both agency IDs enter the root union and both case links are selected
- **AND** all assignments at both agencies and their directed descendants are selected

#### Scenario: Case root alone

- **WHEN** an agency has no null-ended assignments but a civil case references one of its historical assignments
- **THEN** it is selected as a case root

#### Scenario: Overlapping root sets

- **WHEN** an agency has both a null-ended assignment and a linked civil case
- **THEN** the agency and each reachable record are selected once

#### Scenario: Later source adds a report

- **WHEN** a report source references an existing assignment at a qualifying agency
- **THEN** the report, assignment link, and report evidence links are selected without requiring the source to re-emit the agency

## REMOVED Requirements

### Requirement: Include agency arrest aggregate descendants

**Reason**: `agency_arrest_profile` is dropped.

**Migration**: Arrest records are included by the requirement "Include arrest record descendants".

## ADDED Requirements

### Requirement: Include arrest record descendants

Intake SHALL include `arrest` rows through a declared Agency to Arrest `agency_id` edge, and their `arrest_charge`, `arrest_offense` and `arrest_agency_personnel` rows through edges from Arrest. `police_beat` rows SHALL be included through an Agency to PoliceBeat `agency_id` edge.

#### Scenario: Selected agency with arrests

- **WHEN** an agency is selected and arrests reference it
- **THEN** its arrests and their charge, offense and officer rows are selected through the shared graph
