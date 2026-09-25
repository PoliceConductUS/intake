## ADDED Requirements

### Requirement: Established civil-case mappings take precedence

CivilCase SHALL resolve an existing source-name mapping before using its
source-provided natural ID. Unmapped cases SHALL retain the existing natural-ID
behavior without minting replacement IDs. Confirmed historical mappings and
published slugs SHALL be durable workspace state, not importer exceptions.

#### Scenario: A published case is loaded after reset

- **WHEN** the source's docket key maps to an original canonical ID
- **THEN** the case uses that ID and its cached published slug
- **AND** co-emitted case-personnel and case-link references use the restored ID

#### Scenario: Both producers describe a restored case

- **WHEN** CourtListener and Clearinghouse mappings identify the same original case
- **THEN** both resolve to the same canonical ID and established slug

#### Scenario: Identity lookups finish out of order

- **WHEN** records for the same canonical case are registered in order and the later record's identity lookup finishes first
- **THEN** mutation generation still applies those records in registration order
- **AND** the later record updates the earlier record's values regardless of lookup timing

#### Scenario: An unmapped case already uses a natural ID

- **WHEN** no historical mapping exists for a case source name
- **THEN** its source-provided natural ID remains unchanged
- **AND** no new cuid is minted
