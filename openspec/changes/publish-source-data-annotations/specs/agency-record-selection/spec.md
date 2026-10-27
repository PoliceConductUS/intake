## MODIFIED Requirements

### Requirement: Source adapters omit invalid records without weakening validation

Source adapters SHALL preserve identifiable candidates with factual source defects for the shared annotation pipeline. Invalid descriptive values SHALL be retained as reported values or literal annotation values when typed storage cannot represent them. Factual defects SHALL NOT cause agencies, personnel, assignments, contacts or their dependents to be omitted. Identity, foreign-key integrity, canonical envelope structure and explicit exclusions SHALL remain enforced. Source defect annotation SHALL remain distinct from shared agency eligibility selection; this change SHALL NOT fabricate missing identities or relationships.

#### Scenario: Department with invalid address data

- **WHEN** an identifiable agency has invalid source city, address or zip data
- **THEN** intake SHALL preserve the reported values with annotations and retain its otherwise valid assignments and contacts
- **AND** unresolved geography SHALL remain explicitly unresolved rather than inventing a location

### Requirement: Shared agency address validation rejects approved placeholders

Shared source-value checks SHALL flag city and address placeholders NULL, 0, x, xx, -----, N/A and test after trimming and case-folding, and ZIP values not matching five digits or ZIP+4 or starting with an all-zero five-digit ZIP. They SHALL produce record-owned errors rather than discard the source record or literal value. Ambiguous short addresses such as 341, rere and 12t SHALL NOT be declared invalid by this rule. Checks SHALL apply uniformly across sources through shared contracts.

#### Scenario: Placeholder address

- **WHEN** a source supplies address "N/A" for an identifiable agency
- **THEN** the imported record SHALL preserve that source value and show an invalid-address annotation
- **AND** the placeholder SHALL NOT be used to invent coordinates
