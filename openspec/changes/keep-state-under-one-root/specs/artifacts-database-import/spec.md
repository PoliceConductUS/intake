## MODIFIED Requirements

### Requirement: Per-Source Mapping Resolution

The artifacts import pipeline MUST read source-key mappings from entity-scoped ledger files under `$INTAKE_WORKSPACE/state/intake/namespaces/<namespace>/`, where `<namespace>` is `metadata.namespace`.

#### Scenario: MN POST mapping file is selected

- **WHEN** the Artifacts envelope has `metadata.namespace: com/site/my/mnitservices/post-license-search`
- **THEN** intake reads entity-scoped mapping ledger files under `$INTAKE_WORKSPACE/state/intake/namespaces/com/site/my/mnitservices/post-license-search/`

#### Scenario: SourceNameToCanonicalId records are entity-scoped record ledgers

- **WHEN** a source namespace has source-key mappings
- **THEN** each entity type stores mappings in its own exact-kind directory under `$INTAKE_WORKSPACE/state/intake/namespaces/<namespace>/`
- **AND** each mapping record is stored as `<encoded-source-key>.SourceNameToCanonicalId.yaml` in that entity directory
- **AND** a kind-specific directory MUST use the exact kind value, such as `Agency`, `Personnel`, `AgencyPersonnel`, or `LocationPath`
- **AND** intake MUST NOT require a combined all-entity SourceNameToCanonicalId file
- **AND** location path mappings use the full location path as the source key
- **AND** every mapping record includes the canonical intake-owned ID used for database writes

#### Scenario: Workspace path is missing

- **WHEN** `INTAKE_WORKSPACE` is not set
- **THEN** intake fails before reading SourceNameToCanonicalId records or writing database rows

#### Scenario: Namespace mapping directory is missing

- **WHEN** `$INTAKE_WORKSPACE/state/intake/namespaces/<namespace>/` does not exist
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

### Requirement: Shared Update State

The artifacts import pipeline MUST store intake-owned shared update operations outside source-specific mapping files under `$INTAKE_WORKSPACE/state/intake/shared-mutations/`.

#### Scenario: Shared agency update file path

- **WHEN** intake needs shared agency updates for canonical agency ID `<canonical-id>`
- **THEN** intake reads `$INTAKE_WORKSPACE/state/intake/shared-mutations/AgencyUpdate/<encoded-canonical-id>.AgencyUpdate.yaml`

#### Scenario: Shared personnel update file path

- **WHEN** intake needs shared personnel updates for canonical personnel ID `<canonical-id>`
- **THEN** intake reads `$INTAKE_WORKSPACE/state/intake/shared-mutations/PersonnelUpdate/<encoded-canonical-id>.PersonnelUpdate.yaml`

#### Scenario: Shared updates are read before dynamic resolution

- **WHEN** shared update operations exist for a canonical ID
- **THEN** intake uses those updates before attempting dynamic resolution
- **AND** location path lookup checks prepared rows first and the loaded database location path snapshot second

#### Scenario: Database location paths are loaded once

- **WHEN** intake prepares an Import against a connected database
- **THEN** intake loads existing `public.location_path` records into a path and ID lookup snapshot once before resolving location dependencies
- **AND** a miss in the loaded database location path snapshot does not trigger per-path database queries during location dependency resolution

#### Scenario: Missing dynamic properties are persisted as shared updates

- **WHEN** intake dynamically resolves a missing database entity property
- **THEN** intake writes a shared update operation for that canonical ID
- **AND** intake does not write that property to the SourceNameToCanonicalId file

#### Scenario: Source names are mapped to canonical IDs

- **WHEN** intake assigns a canonical ID for a source-owned durable record
- **THEN** intake writes a `SourceNameToCanonicalId` envelope before database create/read/update

#### Scenario: Database row composition

- **WHEN** intake prepares a database record create or update
- **THEN** the database row is composed from the source entity, the source-to-canonical mapping, and applicable shared update operations

### Requirement: Initial MN POST Mapping Setup

The implementation MUST seed the initial MN POST SourceNameToCanonicalId records in intake-owned workspace state under `$INTAKE_WORKSPACE/state/intake/namespaces/com/site/my/mnitservices/post-license-search/` as setup data, not as a generated product feature.

#### Scenario: Known seeded agency mapping is present

- **WHEN** `$INTAKE_WORKSPACE/state/intake/namespaces/com/site/my/mnitservices/post-license-search/Agency/a2j40000000crR2AAI.SourceNameToCanonicalId.yaml` is created
- **THEN** it maps agency source key `a2j40000000crR2AAI` to canonical ID `cm90a1b2c3d4e5f6g7h8i9j1l`

#### Scenario: Known seeded personnel mappings are present

- **WHEN** initial MN POST personnel mapping records are created under `$INTAKE_WORKSPACE/state/intake/namespaces/com/site/my/mnitservices/post-license-search/Personnel/`
- **THEN** they include personnel source keys `003t000000MgMrLAAV` and `0034000001mtGzaAAE` mapped to their known canonical IDs

#### Scenario: Known seeded agency-personnel mappings are present

- **WHEN** initial MN POST agency-personnel mapping records are created under `$INTAKE_WORKSPACE/state/intake/namespaces/com/site/my/mnitservices/post-license-search/AgencyPersonnel/`
- **THEN** it includes agency-personnel source keys `a2mt0000000ncuQAAQ` and `a2m40000000oVI3AAM` mapped to their known canonical IDs from current seed data

#### Scenario: No mapping generator command is exposed

- **WHEN** the initial MN POST mapping file is created
- **THEN** intake does not add a user-facing CLI command for generating mapping files
