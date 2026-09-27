## ADDED Requirements

### Requirement: Source adapters omit invalid records without weakening validation

The TCOLE source SHALL validate agency candidates against the canonical Agency spec and report and omit invalid records. city null SHALL remain invalid. Assignments and contacts referencing an omitted agency SHALL not be emitted. Raw source data SHALL remain intact. Source validity filtering SHALL remain distinct from shared agency eligibility selection, and omission SHALL NOT delete stored records.

#### Scenario: Department with invalid address data

- **WHEN** an agency candidate contains null city, address, or zip_code and fails the existing canonical spec
- **THEN** the source reports the agency source identity and invalid fields and omits the agency and its dependent assignments and contacts
- **AND** valid agency candidates remain available to shared selection
