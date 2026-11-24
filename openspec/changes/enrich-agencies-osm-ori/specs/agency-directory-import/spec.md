## ADDED Requirements

### Requirement: Authoritative agency directory supplies agency details

The planned AZPOST agency-directory import SHALL use the directory returned by the records request as its primary source of agency address and contact data. Rows with complete addresses SHALL reuse the existing address-resolution pipeline. This specification records the existing design; it does not claim that the directory has arrived or that the import is implemented.

#### Scenario: Directory contains an agency address

- **WHEN** the authoritative directory supplies an agency with a complete address
- **THEN** the source maps the reported fields into the existing agency contract
- **AND** the existing pipeline resolves the location without a new name-based resolver

### Requirement: Roster supplies employment relationships

The planned roster import SHALL preserve its reported officer, agency, appointment, termination and certification values when constructing employment relationships. Directory and roster agency references SHALL use the existing canonical identity mapping. Unresolved differences between directory and roster names SHALL remain explicit.

#### Scenario: Roster and directory share an agency label

- **WHEN** the roster's agency label matches the directory's agency label
- **THEN** both references resolve through the existing identity mapping
- **AND** the relationship retains the roster's reported employment dates

### Requirement: Name-based enrichment remains deferred

The OSM/Nominatim and ORI enrichment design SHALL remain deferred until a measured gap in the authoritative directory requires it. This change SHALL NOT introduce that resolver as the primary agency source.

#### Scenario: Directory coverage has not been established

- **WHEN** the directory response or its coverage is still unknown
- **THEN** the name-based enrichment resolver remains unimplemented
