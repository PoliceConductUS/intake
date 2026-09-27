# report-update-generation Specification

## Purpose

Generate and apply source report revisions while preserving identity and comparing explicitly zoned incident timestamps at whole-second resolution.

## Requirements

### Requirement: Changed reports generate updates

Intake MUST compare an existing Review with the fields supplied by its source and generate a ReviewUpdate for changed values. Report identity alone MUST NOT cause changed content to be skipped.

#### Scenario: Edit a manual report through the CLI

- **GIVEN** an applied report acquired from `org.policeconduct.manual`
- **WHEN** the author acquires a revised title, description, or desired outcome and runs `data transform` and `data generate`
- **THEN** generation appends an update containing the changed values
- **AND** the database remains unchanged until `data up`
- **AND** `data up` applies the revision while preserving the report ID and slug

#### Scenario: Generate an unchanged report again

- **GIVEN** a report whose source fields match its stored row
- **WHEN** the source is transformed and generated again
- **THEN** no new data mutation entry is appended

#### Scenario: Preserve fields outside the edit

- **WHEN** report content changes
- **THEN** existing identity and relationships remain unchanged
- **AND** absent source fields do not overwrite stored values

#### Scenario: Update a report with an incident timestamp

- **GIVEN** an existing report with a timestamp-valued incident date
- **WHEN** its title changes while the incident instant stays the same
- **THEN** generation validates the update and changes only the edited fields
- **AND** the stored incident instant is preserved
- **AND** applying and regenerating the report produces no repeated timestamp update

#### Scenario: Apply a changed incident timestamp

- **GIVEN** an existing report with an incident timestamp
- **WHEN** the source supplies a different incident instant
- **THEN** generation produces a valid timestamp update at whole-second resolution
- **AND** replay checks the expected previous instant before applying the change
- **AND** a conflicting stored instant causes replay to fail

### Requirement: Timestamp inputs specify their timezone

Source-writable timestamp-with-time-zone fields MUST include an explicit timezone (`Z` or a numeric UTC offset). Intake MUST reject timezone-less input and accept fractional seconds. Generation, database writes, and comparisons MUST truncate fractional seconds without rounding. Raw source values remain inspectable. Date-only fields and managed audit timestamps retain their existing contracts.

#### Scenario: Reject a timestamp without a timezone

- **WHEN** an artifact, record, or mutation supplies an incident timestamp without a timezone
- **THEN** canonical envelope validation rejects it
- **AND** no database mutation is applied

#### Scenario: Accept an explicit timezone

- **WHEN** an incident timestamp includes `Z` or a numeric UTC offset
- **THEN** canonical validation accepts it
- **AND** timestamp comparison preserves the specified whole-second instant

#### Scenario: Truncate subsecond incident timestamps

- **WHEN** an incident timestamp has a nonzero fractional second
- **THEN** canonical validation accepts it when it has an explicit timezone
- **AND** generated and stored timestamp values discard the fraction without rounding into the next second
- **AND** the original source value remains inspectable

#### Scenario: Compare whole-second representations

- **WHEN** incident timestamps fall within the same whole second after timezone conversion, with or without fractions
- **THEN** both values validate and compare equal
- **AND** regeneration appends no update for that representation difference

#### Scenario: Replay a mutation with fractional seconds

- **WHEN** a create or update mutation supplies a timestamp with fractional seconds
- **THEN** replay stores the value truncated to whole seconds
- **AND** optimistic checks compare expected and stored timestamps at whole-second resolution

#### Scenario: Reject an impossible calendar date

- **WHEN** an incident timestamp specifies an impossible calendar date
- **THEN** intake rejects it instead of normalizing it into a different date
