## ADDED Requirements

### Requirement: Confirmed legacy spelling paths resolve to existing places

The twenty reviewed legacy spelling paths in `aliases.json` SHALL be stored as
manual LocationPathAlias records referencing existing canonical locations.
Their canonical targets SHALL retain their IDs, paths, and other properties.

#### Scenario: Preserve a misspelled legacy place URL

- **WHEN** the manual alias batch is imported
- **THEN** `/tx/bee-county/beevillle/` resolves to `/tx/bee-county/beeville/`
- **AND** no duplicate location or replacement canonical ID is created

#### Scenario: Reset and replay

- **WHEN** the saved mutation chain is replayed against a migrated empty database
- **THEN** all twenty aliases resolve to the same canonical location IDs

### Requirement: Review geographic conflicts without guessing

The remaining audited paths SHALL receive individual review dispositions.
A matching name, nearest place, agency mailing city, or replacement statistical
region alone SHALL NOT establish geographic equivalence for an alias.

#### Scenario: Two distinct communities share a name

- **WHEN** the old path identifies Medina in Bandera County
- **AND** the existing same-name path identifies Medina in Zapata County
- **THEN** no alias between them is added
- **AND** the missing location and conflicting agency assignment are recorded
