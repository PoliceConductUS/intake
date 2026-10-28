# artifacts-validation Specification

## Purpose

TBD - created by archiving change preserve-artifacts-validation-message. Update Purpose after archive.

## Requirements

### Requirement: Explain Artifacts validation failures

The canonical Artifacts IO SHALL include every validation issue with its failing field path, original rejected value, and corresponding validator message when rejecting an envelope. Values SHALL be JSON-encoded so strings, nulls, and numbers remain distinguishable; absent values SHALL be displayed as undefined.

#### Scenario: Personnel name has the wrong type

- **WHEN** an inline Personnel record has first_name as the number 9
- **THEN** the error identifies the record's first_name path and includes the expected-string validation explanation

#### Scenario: Multiple invalid fields

- **WHEN** multiple fields fail validation in an Artifacts envelope
- **THEN** the error includes all validation issues, each paired with its own field path and explanation

#### Scenario: Incorrect suffix type

- **WHEN** a Personnel record contains a numeric suffix
- **THEN** the error includes the actual numeric source suffix, alongside the record path and validation explanation
