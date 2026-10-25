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

### Requirement: Future dates require operator resolution

Intake SHALL block mutation generation for every populated date property (`date`, `date_*`, or `*_date`) after the validation clock's UTC calendar day, including standalone start dates and future expiration dates. Conditional corrections SHALL run first. Operators SHALL be able to use the existing correction or record-exclusion CLI; no website behavior is part of this change.

#### Scenario: Future standalone date

- **WHEN** a date property is later than the validation day, even without a paired date
- **THEN** import fails with the source identity and an instruction to correct or exclude the record

#### Scenario: Operator excludes a record

- **WHEN** the operator records an exclusion and regenerates artifacts
- **THEN** that record does not enter mutation generation
- **AND** the exclusion retains its reason and does not silently delete already-stored database rows
