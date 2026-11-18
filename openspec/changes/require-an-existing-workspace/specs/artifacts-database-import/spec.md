## MODIFIED Requirements

### Requirement: Per-Source Mapping Resolution

The artifacts import pipeline MUST read source-key mappings from entity-scoped ledger files under `$INTAKE_WORKSPACE/intake/state/namespaces/<namespace>/`, where `<namespace>` is `metadata.namespace`.

#### Scenario: MN POST mapping file is selected

- **WHEN** the Artifacts envelope has `metadata.namespace: com/site/my/mnitservices/post-license-search`
- **THEN** intake reads entity-scoped mapping ledger files under `$INTAKE_WORKSPACE/intake/state/namespaces/com/site/my/mnitservices/post-license-search/`

#### Scenario: SourceNameToCanonicalId records are entity-scoped record ledgers

- **WHEN** a source namespace has source-key mappings
- **THEN** each entity type stores mappings in its own exact-kind directory under `$INTAKE_WORKSPACE/intake/state/namespaces/<namespace>/`
- **AND** each mapping record is stored as `<encoded-source-key>.SourceNameToCanonicalId.yaml` in that entity directory
- **AND** a kind-specific directory MUST use the exact kind value, such as `Agency`, `Personnel`, `AgencyPersonnel`, or `LocationPath`
- **AND** intake MUST NOT require a combined all-entity SourceNameToCanonicalId file
- **AND** location path mappings use the full location path as the source key
- **AND** every mapping record includes the canonical intake-owned ID used for database writes

#### Scenario: Workspace path is missing

- **WHEN** `INTAKE_WORKSPACE` is not set, or names a path that is not an existing folder
- **THEN** intake fails before creating a command folder, reading SourceNameToCanonicalId records or writing database rows
- **AND** the error names the path as given and as resolved

#### Scenario: Namespace mapping directory is missing

- **WHEN** `$INTAKE_WORKSPACE/intake/state/namespaces/<namespace>/` does not exist
- **THEN** intake creates the namespace mapping directory before reading or persisting SourceNameToCanonicalId records

#### Scenario: Mapping file is unreadable

- **WHEN** the required mapping file is missing, unreadable, or malformed
- **THEN** intake fails before writing database rows

#### Scenario: Mapping records use entity object maps

- **WHEN** intake reads a mapping file
- **THEN** it expects object maps under `agencies`, `personnel`, and `agencyPersonnel` keyed by source entity ID
- **AND** SourceNameToCanonicalId records contain canonical identity only

#### Scenario: Mapping file shape is validated when read

- **WHEN** intake reads a mapping file
- **THEN** it validates the mapping file shape before canonical mapping resolution
- **AND** rejects malformed mapping records before transforming entities or writing database rows
