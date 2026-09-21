## ADDED Requirements

### Requirement: Intake preserves canonical identities and established slugs

Intake SHALL preserve canonical IDs from durable source-name mappings and established slug values when loading any slug-bearing record. Import SHALL NOT regenerate an established slug from a changed name, ID suffix, source value, or stale prepared update.

#### Scenario: Producer includes a slug

- **WHEN** a personnel or agency source record supplies a slug
- **THEN** that field does not control the canonical system slug
- **AND** intake preserves its established slug or assigns a unique slug for a genuinely new canonical record

#### Scenario: Same-ID row already has a published slug

- **WHEN** an import loads an existing canonical record
- **THEN** its database slug is preserved while source-owned non-identity fields may update
- **AND** a conflicting cached slug causes a visible failure until explicitly corrected

#### Scenario: Reset or source name change

- **WHEN** the database row is absent but the canonical slug cache exists
- **THEN** the new row reuses the cached slug and mapped ID

#### Scenario: New record has no established slug

- **WHEN** a genuinely new canonical record has no database or cached slug
- **THEN** intake generates and caches a slug using its existing rule

#### Scenario: Previously prepared update contains a replacement slug

- **WHEN** intake replays that update against an existing row
- **THEN** replay fails visibly before committing a change to the established database slug

#### Scenario: Existing location path is imported again

- **WHEN** intake encounters the same canonical location-path ID
- **THEN** it preserves the existing path and slug components

### Requirement: Recover verified historical slugs by exact canonical identity

The slug correction SHALL match reference and current records by exact canonical ID, retain source digests and before/after evidence, update only slug fields, and preserve all IDs and relationships. Corrected cache envelopes SHALL use canonical IO and retain provenance.

#### Scenario: Known same-ID personnel slug regression

- **WHEN** reference and current rows share an ID but their slugs differ
- **THEN** explicit correction restores the reference slug in the database and canonical property cache
- **AND** verification reports remaining mismatches and preserves the original correction evidence
