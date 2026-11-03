# personnel-name-quality Specification

## Purpose
TBD - created by archiving change enforce-shared-personnel-name-quality. Update Purpose after archive.
## Requirements
### Requirement: Preserve personnel source values through the original schema contract

Personnel schemas SHALL use the original database-derived string contracts,
without the subsequently added letter-bearing-name refinements or suffix allowlist.
Transforms SHALL preserve supplied values. Existing conditional property corrections
SHALL apply during generation before Model resolution; transforms SHALL NOT load
corrections or receive a correction hook. The existing Model resolution and
validation behavior SHALL remain unchanged.

#### Scenario: Source suffix needs an explicit correction

- **WHEN** a source supplies a string suffix such as `N/A` or `R`
- **THEN** transform preserves it in the artifact
- **AND** generation applies any matching explicit correction using the existing mechanism

#### Scenario: Incorrect field type

- **WHEN** a source supplies a number rather than a string for first_name
- **THEN** canonical IO rejects the field with its path and rejected value

### Requirement: Auditable exclusions

Confirmed fixture decisions SHALL use existing namespace-scoped excluded-record
state with a source key and reason. Excluding personnel SHALL remove dependent
assignments, preserve original evidence, and report removed counts.

#### Scenario: Confirmed fixture has an ordinary given name

- **WHEN** a reason-bearing exclusion identifies the source personnel key
- **THEN** the shared transform excludes that person and dependent assignments
- **AND** a different person with the same name is retained
