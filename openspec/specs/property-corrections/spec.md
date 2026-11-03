# property-corrections Specification

## Purpose
TBD - created by archiving change explicit-unset-corrections. Update Purpose after archive.
## Requirements
### Requirement: Explicit field clearing

The CLI SHALL distinguish set from unset. Set SHALL NOT interpret a string as null. Unset SHALL persist an entry with `operation: unset` and no value. Set entries SHALL contain a non-null value and no unset operation. Unset SHALL require a nullable target property, obey the same conditional matching and overwrite rules as set, and record command provenance. The shared correction adapter SHALL supply null and mark the field explicitly corrected when unset matches. A nonmatching unset SHALL leave the field unchanged.

#### Scenario: Literal null text

- **WHEN** set receives the text null for a string field
- **THEN** it stores that string if valid, otherwise fails
- **AND** it never clears the field

#### Scenario: Conditional unset

- **WHEN** unset matches its original source value
- **THEN** the corrected field is explicitly null, including during dependent generation
- **AND** existing field values do not replace the explicit null

#### Scenario: Unsupported unset

- **WHEN** unset targets a non-nullable field
- **THEN** it fails without writing a correction
