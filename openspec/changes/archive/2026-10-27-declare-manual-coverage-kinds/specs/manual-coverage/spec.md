## ADDED Requirements

### Requirement: Declare manual coverage output

The manual source SHALL declare CoverageLinks and CoverageLinkAgencyPersonnel
as produced artifact kinds and handle their corresponding record kinds through
the existing model-driven manual workflow.

#### Scenario: Transform saved coverage records

- **WHEN** manual state contains a coverage link and its personnel association
- **THEN** transform emits both under declared artifact kinds
- **AND** preserves their source identities and fields
