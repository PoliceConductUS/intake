## ADDED Requirements

### Requirement: Source adapters omit invalid records without weakening validation

The TCOLE source SHALL validate agency candidates against the canonical Agency spec and report and omit invalid records. city null SHALL remain invalid. Assignments and contacts referencing an omitted agency SHALL not be emitted. Raw source data SHALL remain intact. Source validity filtering SHALL remain distinct from shared agency eligibility selection, and omission SHALL NOT delete stored records.

#### Scenario: Department with invalid address data

- **WHEN** an agency candidate contains null city, address, or zip_code and fails the existing canonical spec
- **THEN** the source reports the agency source identity and invalid fields and omits the agency and its dependent assignments and contacts
- **AND** valid agency candidates remain available to shared selection

### Requirement: Shared agency address validation rejects approved placeholders

Shared Agency field validation SHALL reject city and address values NULL, 0, x, xx, -----, N/A, and test after trimming and case-folding. ZIP values SHALL match five digits or ZIP+4 and SHALL NOT start with an all-zero five-digit ZIP. These rules SHALL apply to canonical agency artifacts and create/update validation for every source. Existing optional artifact fields SHALL remain optional; required create fields SHALL remain required. Ambiguous short addresses such as 341, rere, and 12t SHALL NOT be banned by this change. No global string validator SHALL be tightened for unrelated fields.

#### Scenario: Invalid placeholder address from any source

- **WHEN** an Agency contains one of the approved address or city placeholders, including mixed case or surrounding whitespace
- **THEN** the canonical field validation rejects it

#### Scenario: Postal format

- **WHEN** an agency ZIP is 0, 00000, 00000-0000, or a malformed ZIP
- **THEN** it is rejected
- **AND** valid ZIPs with leading zeros and valid ZIP+4 values remain accepted
