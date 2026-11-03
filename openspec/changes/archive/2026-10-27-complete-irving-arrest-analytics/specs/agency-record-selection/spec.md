## ADDED Requirements

### Requirement: Include agency arrest aggregate descendants

Intake SHALL include AgencyArrestProfile records through a declared Agency to AgencyArrestProfile agency_id edge in the shared agency graph.

#### Scenario: Eligible agency with complete arrest aggregate

- **WHEN** an agency is selected and an agency arrest profile references it
- **THEN** its aggregate is selected through the same shared graph as its other descendants
