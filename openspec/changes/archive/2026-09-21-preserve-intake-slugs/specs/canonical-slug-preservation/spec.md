## ADDED Requirements

### Requirement: Canonical URL identity survives intake

Intake MUST preserve established canonical IDs and slugs for every slug-bearing entity when loading records. Source slugs MUST NOT override or assign canonical slugs. New slugs MUST be assigned uniquely by intake.

#### Scenario: Corrected source name and slug

- **WHEN** an existing entity is imported with a corrected name or a different source slug
- **THEN** its canonical ID and established slug remain unchanged

#### Scenario: Cache survives database reset

- **WHEN** a canonical entity has a cached slug and no database row
- **THEN** intake reuses the cached slug and canonical ID

#### Scenario: Database and cache disagree

- **WHEN** the database and canonical cache hold different slugs for the same entity
- **THEN** intake fails loudly instead of silently changing either value

#### Scenario: A new record arrives before an existing cached record after reset

- **WHEN** a new entity would generate a slug already cached for another canonical identity, including one absent from the current import
- **THEN** intake assigns the new entity a different unique slug and preserves the existing cached assignment

### Requirement: Resolved slugs are durable properties

Intake MUST persist resolved slugs through the canonical ResolvedProperty adapter and register reused slugs with the command allocator.

#### Scenario: Existing database slug lacks cache

- **WHEN** an established database slug has no cache entry
- **THEN** intake caches the established value and uses it for the record

### Requirement: Replay preserves durable URL identity

Replay MUST reject changes to established primary keys, slugs, and LocationPath paths.

#### Scenario: Mutation changes a published slug

- **WHEN** an update mutation attempts to change an existing slug
- **THEN** replay fails and its database transaction leaves the original record unchanged

#### Scenario: Mutation asserts an unchanged URL

- **WHEN** a mutation asserts or sets an established URL identity to its existing value
- **THEN** the immutable-field rule permits it
