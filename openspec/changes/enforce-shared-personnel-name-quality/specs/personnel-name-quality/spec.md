## ADDED Requirements

### Requirement: Mandatory field-scoped personnel validation

Shared intake schemas SHALL reject nonempty first, middle, or last names with no
Unicode letters and suffixes outside the existing generational vocabulary.
Validation SHALL apply to artifacts, creates, updates, corrections and replay
without source opt-in. Names SHALL NOT be rejected merely for matching a
placeholder word. Validation SHALL NOT infer corrected names or suffixes.

#### Scenario: Numeric-only identity from any source

- **WHEN** Texas, Oregon or a future source supplies first_name `9`
- **THEN** shared validation rejects the field before a database write
- **AND** the original evidence remains unchanged and the error identifies the field

#### Scenario: Real surname resembles a placeholder

- **WHEN** a person has surname `Null`, `Test`, `Tester`, `Sample` or `Guest`
- **THEN** the name is accepted without a fixture inference

#### Scenario: Repair historical invalid value

- **WHEN** an update replaces an invalid name or suffix with a valid value
- **THEN** its historical `from` value remains available for optimistic comparison
- **AND** the replacement is validated

### Requirement: Auditable exclusions

Confirmed fixture decisions SHALL use existing namespace-scoped excluded-record
state with a source key and reason. Excluding personnel SHALL remove dependent
assignments, preserve original evidence, and report removed counts.

#### Scenario: Confirmed fixture has an ordinary given name

- **WHEN** a reason-bearing exclusion identifies the source personnel key
- **THEN** the shared transform excludes that person and dependent assignments
- **AND** a different person with the same name is retained
