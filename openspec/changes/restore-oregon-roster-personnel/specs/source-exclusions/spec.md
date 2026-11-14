## ADDED Requirements

### Requirement: Temporary exclusions depend on exact source values

A workspace exclusion MAY contain a nonempty `when` object mapping source spec fields to JSON values. A conditional exclusion SHALL be active only when every named field exists on the unexcluded source candidate and deeply equals its expected typed value. An absent field SHALL differ from null. Changed source values SHALL proceed through normal record validation, identity resolution and mutation generation. An exclusion without conditions SHALL retain its unconditional meaning. Reasons SHALL NOT determine lifetime or conditions.

The same active rules SHALL control exclusion evidence, dependent-record removal and logging. Conditions SHALL remain workspace metadata and SHALL NOT widen the existing strict public SourceExclusions payload. Inactive rules SHALL NOT remain in generated exclusion evidence.

#### Scenario: Source fixes a bad field

- **GIVEN** a temporary exclusion conditioned on an invalid original first name
- **WHEN** a new acquisition supplies a different first name
- **THEN** the old exclusion does not remove that person or supported relationships, and ordinary validation and existing canonical identity mappings apply
- **AND** other unconditional exclusions remain effective

#### Scenario: Original problem remains

- **WHEN** all exclusion conditions still match the source candidate
- **THEN** the candidate and dependent records remain excluded with the existing evidence shape

#### Scenario: Missing and typed values differ

- **GIVEN** a condition whose expected source value is null
- **WHEN** that source field is absent rather than explicitly null
- **THEN** the rule is inactive and normal required-data validation still applies
- **AND** fields inherited from an object prototype do not count as present
- **AND** multiple conditions require all values to match with exact deep equality

#### Scenario: Inactive rule clears earlier evidence

- **GIVEN** an earlier transform published evidence for a conditional exclusion
- **WHEN** the source value no longer matches
- **THEN** the next transform omits that rule from public exclusion evidence and active-exclusion logs
- **AND** unconditional exclusions and their dependent-record filtering remain effective

#### Scenario: Streamed source candidates and dependents

- **WHEN** a matching source candidate is emitted in a streamed artifact batch, or depends on an excluded parent
- **THEN** the shared exclusion decision removes it just as it would an inline candidate, with the same evidence ownership and logging rules
- **AND** canonical artifact IO, bounded batch processing and source identities remain intact

### Requirement: Configure conditions through the existing exclusion operation

The existing data exclude operation SHALL accept `--when <json>` for a nonempty object of source-field conditions. Explicit `--replace` SHALL update only an existing exact kind and source-key exclusion while preserving all unrelated entries. Without replacement an existing key SHALL fail; replacement of a missing key SHALL fail. Malformed, empty and array conditions SHALL fail visibly. The required reason SHALL remain required. This operation SHALL NOT replace source values, include a record directly, or write database rows.

#### Scenario: Bind a saved temporary exclusion

- **WHEN** an operator explicitly replaces an existing exclusion with its original problematic source values as conditions
- **THEN** intake stores those conditions without changing raw source data or database records

#### Scenario: Reject invalid configuration without replacing other curation

- **WHEN** conditions are malformed JSON, empty, an array or a scalar
- **THEN** the operation fails visibly without writing an exclusion
- **AND** a duplicate without replacement or replacement of a missing exact key fails without changing other entries

#### Scenario: Concurrent changes preserve unrelated rules

- **WHEN** multiple operations change different exclusions in the same source file at overlapping times
- **THEN** successful operations preserve the other changes, or contention fails visibly with intact state
- **AND** readers observe a complete exclusion document and the existing file permissions remain unchanged
