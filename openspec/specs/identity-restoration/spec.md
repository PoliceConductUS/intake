# identity-restoration Specification

## Purpose

TBD - created by archiving change restore-established-identities. Update Purpose after archive.

## Requirements

### Requirement: Restore established identity explicitly

The shared CLI SHALL append an IdentityRestoration chain event requiring namespace, entity kind, source name, expected erroneous ID, original ID, reason, and evidence. It SHALL reject absent or mismatched mappings, absent database rows, target collisions, and incoming foreign keys without ON UPDATE CASCADE. Ordinary updates SHALL continue to reject identity changes.

#### Scenario: Restore a published identity

- **WHEN** a source record is mapped to the expected erroneous ID and its established original ID is unoccupied
- **THEN** generation appends an auditable restoration event without changing the database or mapping
- **AND** data up restores the database ID and both ledger directions

#### Scenario: Recover interrupted ledger persistence

- **WHEN** the restoration transaction committed but ledger persistence was interrupted
- **THEN** data up SHALL deterministically complete canonical ledger IO from the immutable event
- **AND** generation SHALL fail until ledger restoration is complete

#### Scenario: Guarded refusal

- **WHEN** the current mapping is unexpected, the original ID is occupied, or a referenced table lacks cascade updates
- **THEN** restoration SHALL fail without changing data or relaxing constraints
