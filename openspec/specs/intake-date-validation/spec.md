# intake-date-validation Specification

## Purpose

TBD - created by archiving change reject-implausible-date-pairs. Update Purpose after archive.

## Requirements

### Requirement: Temporarily omit records with invalid source dates

Root intake SHALL validate source dates after conditional corrections. A retained
date-pair defect or future date SHALL omit the entire affected record and its
dependents from the current generation, while allowing valid records to proceed.
Each omission SHALL report namespace, kind, source name, field, original value,
and reason. Raw inputs SHALL remain unchanged; invalid end dates SHALL NOT be
cleared to imply current employment. No persistent exclusion SHALL be created.

#### Scenario: Invalid date pair

- **WHEN** an assignment ends before its start or spans more than 70 years
- **THEN** generation omits the assignment and reports the defect
- **AND** the original dates remain inspectable

#### Scenario: Future standalone date

- **WHEN** a populated date property (`date`, `date_*`, or `*_date`) exceeds the validation clock's UTC day
- **THEN** generation omits the record and reports its identity, value, and reason

#### Scenario: Corrected source on a later run

- **WHEN** a later source input or explicit conditional correction resolves the defect
- **THEN** intake evaluates the corrected record normally without removing a persistent exclusion

#### Scenario: Dependent records

- **WHEN** another record references an omitted invalid record
- **THEN** intake omits and reports that dependent record using the shared dependency filtering
- **AND** unrelated valid records remain eligible

#### Scenario: Existing database record

- **WHEN** an omitted record already exists in the database
- **THEN** omission does not claim to repair or delete that existing row
