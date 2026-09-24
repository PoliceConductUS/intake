## ADDED Requirements

### Requirement: Business-key identities survive database resets

The shared business-key identity resolver SHALL persist IDs in the existing
source-name ledger under intake-owned derived business keys. It SHALL consult
that durable mapping before database lookup or ID generation. Same business-key
records SHALL converge independently of source namespace or source-local name.
Recovered and newly minted IDs SHALL be persisted before returning; failed
persistence SHALL fail resolution. Historical corrections SHALL be workspace
mapping data, never per-record code or direct database writes.

#### Scenario: A new entity is resolved again after reset

- **WHEN** an entity was resolved with no existing database row
- **AND** a new command runs against an empty database using the same workspace
- **THEN** AuthorityLicense, License and ArrestProfile reuse their recorded IDs
- **AND** dependent foreign keys use those same IDs

#### Scenario: An existing database identity has no mapping

- **WHEN** database lookup recovers an existing ID for the business key
- **THEN** that ID is persisted before resolution completes
- **AND** a later empty-database command reuses it

#### Scenario: Multiple source variants identify one business key

- **WHEN** different source namespaces or names resolve the same business key
- **THEN** concurrent facades and subsequent commands use one durable ID

#### Scenario: A historical ID has been restored in the mapping

- **WHEN** a workspace mapping records an original ID and the database still has a replacement
- **THEN** identity resolution uses the mapped original ID
