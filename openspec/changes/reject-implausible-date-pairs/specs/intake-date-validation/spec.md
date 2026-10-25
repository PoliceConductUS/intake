## ADDED Requirements

### Requirement: Invalid date pairs block intake mutation generation

Intake SHALL reject mutation generation if any input retains a reported date-pair defect after conditional corrections. The error SHALL identify the source namespace, record kind, source name, field, original value, and reason. Raw inputs SHALL remain unchanged. No replacement date or employment-status inference SHALL be introduced.

#### Scenario: Implausible retained date

- **WHEN** an assignment ends before its start or spans more than 70 years
- **THEN** mutation generation fails with the source identity and reason, even without a logger
- **AND** the original date remains inspectable

#### Scenario: Supported conditional correction

- **WHEN** a conditional property correction yields a valid date pair
- **THEN** date-pair validation does not block mutation generation

#### Scenario: Previously stored invalid date

- **WHEN** an invalid assignment already exists in the database
- **THEN** rejecting an import does not claim to repair or remove that existing row
