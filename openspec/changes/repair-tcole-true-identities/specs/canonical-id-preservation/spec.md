## ADDED Requirements

### Requirement: Boolean-encoded TCOLE names preserve established identities

Excel boolean name cells SHALL be decoded as boolean text rather than their raw
numeric XML storage value. Confirmed source identifiers SHALL resolve to their
original personnel and employment IDs and original published personnel slugs.

#### Scenario: True was stored as a boolean

- **WHEN** the workbook encodes a first or last name as boolean true
- **THEN** the decoded name is `true` (case-insensitive), never `1`
- **AND** source identifiers remain unchanged

#### Scenario: Reconstruct the five confirmed omitted identities

- **WHEN** the corrected local mutation lineage is replayed
- **THEN** the five personnel records have their original IDs and slugs
- **AND** the five matched employment records have their original IDs
- **AND** all license IDs and relationship contents are preserved
- **AND** none of the ten mistakenly allocated IDs is recreated
