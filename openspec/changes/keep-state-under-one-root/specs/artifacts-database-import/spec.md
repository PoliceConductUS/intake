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

## REMOVED Requirements

### Requirement: Import Type Registry

**Reason**: `npm run publish:import-schemas` and its `intake/schemas/` output are removed as dead code; the database is the single source of intake's models (owner's ruling, 2026-11-18). The rest of the requirement is unchanged and is added back as "Import type registry is the canonical contract".

**Migration**: Nothing reads the published schemas. `type-annotation-envelopes` publishes its own contract when it lands.

### Requirement: Shared Update State

**Reason**: No code stores shared update operations, and `test/architecture.test.ts` forbids the name `shared-mutations`. What the code does is cache each resolved value as a `ResolvedProperty` (owner's ruling, 2026-11-18); "Resolved Property State" states it.

**Migration**: None; no workspace holds `shared-mutations` files.

### Requirement: Shared Update State Shape

**Reason**: As for "Shared Update State"; "Resolved Property Shape" states the envelope the code writes.

**Migration**: None.

## ADDED Requirements

### Requirement: Import type registry is the canonical contract

The artifacts import pipeline MUST use an intake-owned import-type registry as the canonical contract for supported artifact kinds, record schemas, target tables, and import dependencies.

#### Scenario: Import type schemas are canonical

- **WHEN** intake validates a typed artifact
- **THEN** it validates each inline record `spec` or referenced record-envelope `spec` with the canonical Zod schema for that artifact kind
- **AND** source modules may use the same canonical schemas to validate generated artifacts before publishing Artifacts
- **AND** source modules map their raw source entities into these import types instead of encoding database-write behavior

#### Scenario: Import order comes from dependencies

- **WHEN** an Artifacts envelope contains multiple typed artifacts
- **THEN** intake sorts loaded artifacts by the dependency graph in the import-type registry before transformation
- **AND** artifact order in `spec.artifacts` does not affect import behavior
- **AND** current location-path artifacts are ordered before location-path geometry and aliases
- **AND** agency and personnel artifacts are ordered before agency-personnel relationship artifacts
- **AND** dependency cycles fail before SourceNameToCanonicalId records or database writes

#### Scenario: Canonical artifact reader and writer are reusable

- **WHEN** source modules produce typed import artifacts
- **THEN** they can use intake's canonical artifact writer to validate and serialize the artifact before publishing it
- **AND** the canonical writer injects `apiVersion: policeconduct.org/intake/v1alpha1`
- **AND** the canonical writer rejects records that are not valid for the artifact kind
- **AND** the canonical writer returns the artifact SHA-256 digest that can be recorded in the Artifacts envelope
- **AND** intake's Artifacts reader uses the same canonical artifact reader to validate artifact files

#### Scenario: Generated shared IO is limited to database import artifacts

- **WHEN** intake generates shared IO types
- **THEN** generated envelopes are limited to supported database import artifacts and their singular record envelopes
- **AND** generated shared IO does not include `Command.ts`

#### Scenario: Command envelope IO is shared and canonical

- **WHEN** intake or a source module reads or writes a command YAML envelope
- **THEN** the envelope uses `apiVersion: policeconduct.org/intake/v1alpha1`
- **AND** the envelope uses `kind: Command`
- **AND** the envelope has required `metadata.name`
- **AND** the envelope has required `metadata.namespace`
- **AND** the envelope MUST NOT use `metadata.runId`
- **AND** the envelope has required `spec.statePath`
- **AND** the envelope has required `spec.path`
- **AND** the envelope has required `spec.sharedIoRoot`
- **AND** the envelope has required `spec.args` as an ordered string array
- **AND** the file name is `<encoded-metadata.name>.Command.yaml`
- **AND** every `Command` envelope read or write goes through shared `Command` IO

#### Scenario: Every envelope read and write uses canonical IO

- **WHEN** intake or a source module reads or writes a YAML file with `apiVersion` and `kind`
- **THEN** that envelope kind has canonical IO
- **AND** the read or write goes through that canonical IO
- **AND** a command directory is not itself an envelope
- **AND** a YAML envelope without canonical IO is invalid and must not be read or written

#### Scenario: Canonical envelope IO rejects malformed identity and specs

- **WHEN** canonical envelope IO reads, writes, or constructs any intake YAML envelope
- **THEN** it rejects any envelope whose `apiVersion` is not `policeconduct.org/intake/v1alpha1`
- **AND** it rejects any envelope whose `kind` is not the exact kind handled by that IO
- **AND** it rejects any `spec` that is missing required fields, uses unsupported field names, or has values outside the declared schema for that kind
- **AND** unknown envelope, metadata, and spec keys are rejected unless the key is inside an explicitly declared free-form payload field

### Requirement: Resolved Property State

The artifacts import pipeline MUST read and write each value it resolves, derives or accepts for a database field, rather than taking it from the source record, as a `ResolvedProperty` under `$INTAKE_WORKSPACE/state/intake/ResolvedProperty/`, named by the subject's `apiVersion`, kind and canonical ID and the target property.

#### Scenario: Resolved property file path

- **WHEN** intake resolves `latitude` for the agency with canonical ID `<canonical-id>`
- **THEN** it reads and writes `$INTAKE_WORKSPACE/state/intake/ResolvedProperty/<encoded policeconduct.org/intake/v1alpha1:Agency:<canonical-id>:latitude>.ResolvedProperty.yaml`

#### Scenario: Resolved properties are read before dynamic resolution

- **WHEN** a `ResolvedProperty` holds an entry for the subject, property and input fingerprint
- **THEN** intake uses that value before attempting dynamic resolution
- **AND** location path lookup checks prepared rows first and the loaded database location path snapshot second

#### Scenario: Database location paths are loaded once

- **WHEN** intake prepares an Import against a connected database
- **THEN** intake loads existing `public.location_path` records into a path and ID lookup snapshot once before resolving location dependencies
- **AND** a miss in the loaded database location path snapshot does not trigger per-path database queries during location dependency resolution

#### Scenario: Missing dynamic properties are persisted as resolved properties

- **WHEN** intake dynamically resolves a missing database entity property
- **THEN** intake writes a `ResolvedProperty` entry for that subject and property
- **AND** intake does not write that property to the SourceNameToCanonicalId file

#### Scenario: Source names are mapped to canonical IDs

- **WHEN** intake assigns a canonical ID for a source-owned durable record
- **THEN** intake writes a `SourceNameToCanonicalId` envelope before database create/read/update

#### Scenario: Database row composition

- **WHEN** intake prepares a database record create or update
- **THEN** the database row is composed from the source entity, the source-to-canonical mapping, and applicable resolved properties

### Requirement: Resolved Property Shape

Each `ResolvedProperty` file MUST be a typed YAML resource with `apiVersion: policeconduct.org/intake/v1alpha1`, `kind: ResolvedProperty`, `metadata.namespace: intake`, `metadata.name` equal to the subject's `apiVersion`, kind and canonical ID and the target property joined by `:`, and a `spec` holding the subject, the target property and its entries, each an input fingerprint, a value and the sources it came from.

#### Scenario: Resolved property resource is complete

- **WHEN** intake writes a resolved property file for an agency's `latitude`
- **THEN** the YAML has `kind: ResolvedProperty` and `metadata.namespace: intake`
- **AND** `spec.subject` names the agency's `apiVersion`, kind and canonical ID, and `spec.targetProperty` is `latitude`
- **AND** each entry of `spec.entries` has an `inputFingerprint`, a `value` and its `sources`

#### Scenario: Resolved property resource shape is required

- **WHEN** a `ResolvedProperty` file is missing `apiVersion`, `kind`, `metadata.name`, `metadata.namespace` or `spec`
- **THEN** intake rejects it as malformed before using it for import preparation

#### Scenario: Agency coordinates represent agency address

- **WHEN** an agency row is written from an agency mapping record
- **THEN** `latitude` and `longitude` represent the agency address point, not the location path, place centroid, county centroid, state centroid, map viewport, or any other location hierarchy geometry

#### Scenario: Agency coordinates are not dynamically copied from location paths

- **WHEN** an agency row needs `latitude` or `longitude`
- **THEN** intake MUST NOT resolve those values from `public.location_path`
- **AND** intake fails the affected row write if an agency-address coordinate source is unavailable
