# source-update-comparison Specification

## Purpose

Compare supplied source fields with existing rows so changes produce updates and unchanged input produces no mutation.

## Requirements

### Requirement: Existing source records are compared

Intake MUST compare supplied fields against existing rows for every imported entity kind. It MUST NOT expose a read-only upsert mode that suppresses that comparison. Stable identity and idempotence MUST NOT be treated as immutable content. Unsupported changes or comparison failures MUST surface as errors rather than reads or successful no-ops.

#### Scenario: Correct an existing location

- **WHEN** source input changes a LocationPath display name or spatial fields
- **THEN** generation produces a LocationPathUpdate
- **AND** replay applies the correction while preserving its canonical identity and path

#### Scenario: Correct an existing alias target

- **WHEN** source input corrects an existing LocationPathAlias target to another valid location
- **THEN** generation produces a LocationPathAliasUpdate
- **AND** replay applies the correction while preserving alias_path and enforcing existing conflict rules

#### Scenario: Edit report personnel details

- **WHEN** source input changes a ReviewPersonnel rating or other nonidentity field
- **THEN** generation produces a ReviewPersonnelUpdate
- **AND** replay applies it while preserving identity and absent fields

#### Scenario: Repeat unchanged input

- **WHEN** all supplied source fields match the existing row
- **THEN** the planner omits the check-only update
- **AND** generation appends no data-chain entry

#### Scenario: Correct a streamed location boundary

- **WHEN** a streamed LocationPathGeometry record supplies a changed boundary for an existing location
- **THEN** generation produces a LocationPathGeometryUpdate instead of an existence-only read
- **AND** replay checks and updates the boundary while preserving its location identity
- **AND** unchanged geometry produces no mutation
- **AND** records continue to be processed one at a time

#### Scenario: Converge within one run

- **WHEN** multiple facade-managed records resolve to the same canonical identity in one run
- **THEN** later records compare against the planned state without producing duplicate creates

#### Scenario: Explicitly assert an existing row

- **WHEN** an explicit read/assertion operation is requested
- **THEN** the existing read envelope remains supported
- **AND** that operation does not replace comparison of an imported source edit
