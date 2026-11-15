## ADDED Requirements

### Requirement: Manual location creation

The manual source SHALL accept LocationPath records through its existing acquisition interface and emit LocationPaths artifacts using canonical shared IO. A manually supplied place MAY omit geometry, centroid, and bounding box. Import SHALL resolve its parent by the supplied location path and assign or reuse its canonical ID through the durable source mapping ledger. Existing paths and IDs SHALL remain stable on re-import and database reconstruction.

#### Scenario: Community without a Census polygon

- **WHEN** an operator acquires a manual place with its source-local identity, path, display name, and existing county parent path
- **THEN** import creates the location under that county without requiring or inventing geometry
- **AND** aliases may reference the new place in the same import

#### Scenario: Re-import and reconstruction

- **WHEN** the manual artifacts are imported again or their saved mutations are replayed into a database with the same parent records
- **THEN** the place retains its canonical ID, path, parent, and aliases

#### Scenario: Missing parent

- **WHEN** the supplied parent path does not resolve
- **THEN** import fails visibly before creating the manual place
- **AND** no parent is guessed or minted

#### Scenario: Automatic resolution remains unchanged

- **WHEN** a manual place has no boundary
- **THEN** its existence does not make it a point-in-boundary candidate
- **AND** agency assignments that cannot resolve automatically still require the existing explicit manual-resolution mechanism

#### Scenario: Standalone manual source

- **WHEN** the full update command orders automatic sources
- **THEN** it excludes sources declared standalone, including the manual source
- **AND** manual acquisition, transformation, generation, and replay remain available explicitly
- **AND** manual location production cannot create a dependency cycle in automatic source ordering
