## ADDED Requirements

### Requirement: Initial agency roots for an empty database

Intake SHALL support a source-namespaced InitialAgencyRoots envelope whose unique source agency names supplement ordinary agency roots only when the agency table is empty at import preparation. Census and reference records SHALL NOT prevent this bootstrap. The envelope SHALL use strict canonical IO and the intake-owned namespace state location. TCOLE's initial roots SHALL be populated from exact live production TX agency sitemap slug matches to saved canonical records and durable TCOLE source-name mappings. Provenance and unmatched paths SHALL remain inspectable.

Initial roots SHALL select their directed descendants using shared traversal. They SHALL NOT bypass source validation or explicit exclusions, fabricate absent records, alter canonical IDs/slugs, or exclude other ordinary qualifying roots. Nonempty imports SHALL retain existing selection behavior. An absent initial-root envelope SHALL mean no supplemental roots; a malformed envelope read for bootstrap SHALL fail visibly.

#### Scenario: Published historical agency during initial import

- **WHEN** the agency table is empty and a valid TCOLE candidate appears in the saved initial source-name list with only ended assignments
- **THEN** that agency and its directed reachable records are selected with their established canonical IDs and slugs

#### Scenario: Existing database does not bootstrap new historical agencies

- **WHEN** the agency table already contains any agency
- **THEN** the initial root list does not add roots and ordinary open-assignment/case qualification and existing-record retention apply

#### Scenario: Invalid published candidate

- **WHEN** a listed source agency is invalid, explicitly excluded, or absent from the incoming candidates
- **THEN** the initial list does not fabricate or reintroduce that agency

#### Scenario: Additional qualifying agency

- **WHEN** a valid agency outside the initial list has a null-ended assignment or available case relationship
- **THEN** it remains selected through ordinary roots
