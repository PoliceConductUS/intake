## ADDED Requirements

### Requirement: Manual intake can restore a published review

The manual source SHALL accept Review and ReviewPersonnel records using their
shared specs. A restored review SHALL retain its established ID, slug, narrative,
location and evidence links. Established ReviewPersonnel mappings SHALL take
precedence over composed IDs; unmapped relationships SHALL retain their existing
composed-ID behavior. All historical identity corrections SHALL live in workspace
mappings or cache, not record-specific application code.

#### Scenario: A curated review is loaded after the roster

- **WHEN** an operator records an existing review and its resolved personnel links
- **THEN** manual transform emits Reviews and ReviewPersonnel artifacts
- **AND** generation preserves the report identity and its related records

#### Scenario: An existing personnel relationship has a mapped ID

- **WHEN** the manual source name maps to an original ReviewPersonnel ID
- **THEN** the relationship uses that ID and resolves both references normally

#### Scenario: An unmapped relationship is generated

- **WHEN** no original ReviewPersonnel mapping exists
- **THEN** identity remains composed from review_id and agency_personnel_id
