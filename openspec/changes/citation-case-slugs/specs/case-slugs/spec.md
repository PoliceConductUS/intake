## ADDED Requirements

### Requirement: Citation-derived case slugs

Intake SHALL generate case slugs from a sourced full citation when available, otherwise from a labelled docket reference using exact source metadata and an established court abbreviation dataset.

#### Scenario: Docket without opinion citation

- **WHEN** a case has no sourced opinion citation
- **THEN** the generated reference includes title, docket, court, and filing date explicitly identified as filed
- **AND** it does not represent the filing date as a decision date

### Requirement: Audited URL migration

The migration SHALL preserve canonical IDs and retain previous URLs as aliases of the same case.

#### Scenario: Existing case changes slug

- **WHEN** a citation migration changes an established case slug
- **THEN** database and canonical cache agree and old URLs redirect directly to its built canonical page
- **AND** an unchanged rerun is a no-op

#### Scenario: Normal update and reset

- **WHEN** the operator runs `data update` successfully
- **THEN** intake migrates existing case slugs and records URL history in the same data chain
- **AND** a later reset restores canonical slugs and aliases from retained workspace state
