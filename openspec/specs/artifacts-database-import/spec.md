# artifacts-database-import Specification

## Purpose

TBD - created by archiving change import-artifacts-to-database. Update Purpose after archive.

## Requirements

### Requirement: Manifest Import Command

The intake CLI MUST provide `intake import artifacts <artifacts-ref>` to import an existing local `Artifacts` envelope without running a source module.

#### Scenario: Operator imports a local Artifacts envelope

- **WHEN** an operator runs `intake import artifacts /path/to/artifacts.yaml`
- **THEN** intake reads the Artifacts envelope from the provided local path and uses the direct artifacts import pipeline

#### Scenario: Artifacts import does not run source modules

- **WHEN** an operator runs `intake import artifacts /path/to/artifacts.yaml`
- **THEN** intake MUST NOT invoke any source module command or source-module orchestration

#### Scenario: Manifest command validates argument count

- **WHEN** an operator runs `intake import artifacts` without a artifacts path or with extra positional arguments
- **THEN** intake fails without reading mappings or writing database rows

### Requirement: Artifacts Validation

The artifacts import pipeline MUST validate the Artifacts envelope before reading SourceNameToCanonicalId records or writing database rows.

#### Scenario: Manifest path is unreadable

- **WHEN** the artifacts path is missing, unreadable, or not a file
- **THEN** intake fails before reading SourceNameToCanonicalId records or writing database rows

#### Scenario: Manifest YAML is malformed

- **WHEN** the Artifacts envelope file cannot be parsed as YAML
- **THEN** intake fails before reading SourceNameToCanonicalId records or writing database rows

#### Scenario: Manifest apiVersion or kind is unsupported

- **WHEN** the Artifacts envelope does not use supported `apiVersion: policeconduct.org/intake/v1alpha1` and `kind: Artifacts`
- **THEN** intake fails before reading SourceNameToCanonicalId records or writing database rows

#### Scenario: Artifacts namespace is missing

- **WHEN** `metadata.namespace` is missing or empty
- **THEN** intake fails before reading SourceNameToCanonicalId records or writing database rows

#### Scenario: Artifacts spec source is rejected

- **WHEN** `spec.source` is present
- **THEN** intake fails before reading SourceNameToCanonicalId records or writing database rows

#### Scenario: Artifacts name is missing

- **WHEN** `metadata.name` is missing or empty
- **THEN** intake fails before reading SourceNameToCanonicalId records or writing database rows

#### Scenario: Artifacts references typed artifacts

- **WHEN** an Artifacts envelope is read
- **THEN** Artifacts envelope content is described by `spec.artifacts`
- **AND** artifact list order has no import semantics
- **AND** `spec.artifacts[*].kind` identifies a supported import type
- **AND** a referenced artifact item has shape `{ ref: { path, kind, sha256? } }`
- **AND** an inline artifact item has shape `{ kind, spec }`
- **AND** `spec.artifacts[*].ref.path` is resolved relative to the Artifacts envelope file
- **AND** `spec.artifacts[*].ref.sha256`, when present, is verified against the referenced artifact file contents before transformation

#### Scenario: Database import persists location path geometry artifacts

- **WHEN** the artifacts import pipeline reads an Artifacts envelope for database import
- **THEN** it resolves and validates artifact kinds with database targets
- **AND** it transforms `LocationPathGeometries` records into database mutations for `public.location_path_geometry`
- **AND** each location path geometry mutation writes the record's GeoJSON boundary to `public.location_path_geometry.boundary`
- **AND** each location path geometry row is keyed 1:1 by the canonical `public.location_path.location_path_id`

#### Scenario: Typed artifacts use records

- **WHEN** intake reads a artifact
- **THEN** the artifact uses the same `apiVersion`
- **AND** the artifact has a supported `kind`
- **AND** the artifact requires `metadata.name` and `metadata.namespace`
- **AND** the artifact `metadata.namespace` matches the Artifacts `metadata.namespace`
- **AND** kind-specific source records are stored under `spec.records`
- **AND** each `spec.records` key is the source-local stable record identity
- **AND** each inline record value is an object with only `spec`
- **AND** each referenced record value is an object with only `ref`
- **AND** unknown top-level, metadata, spec, or record fields are rejected by the canonical import-type schema for that kind

#### Scenario: Source entity identity is the record key

- **WHEN** a typed artifact record is included inline under `spec.records`
- **THEN** the source-local stable identity is the `spec.records` key
- **AND** inline record metadata is not allowed because `metadata.name` is derived from the record key and `metadata.namespace` is derived from the parent artifact namespace
- **AND** record body `_metadata` is not allowed
- **AND** non-underscore properties such as `centroid` or `bbox` are ordinary import-type fields and MUST either be supported by the canonical import-type schema and database CRU path or fail loudly

#### Scenario: Referenced artifact records are standalone envelopes

- **WHEN** a typed artifact record value is `{ ref: { path: "records/example.yaml", kind: "<ParentRecordKind>" } }`
- **THEN** intake resolves the path relative to the parent artifact file
- **AND** absolute paths and parent-directory traversal are rejected
- **AND** the referenced YAML uses `apiVersion: policeconduct.org/intake/v1alpha1`
- **AND** the referenced YAML kind is `<ParentKind>Record`
- **AND** the referenced YAML requires `metadata.name` and `metadata.namespace`
- **AND** the referenced `metadata.name` matches the parent `spec.records` key
- **AND** the referenced `metadata.namespace` matches the parent artifact namespace
- **AND** the referenced `spec` is validated by the same canonical import-type schema as an inline record

#### Scenario: Writers own YAML resource filenames

- **WHEN** an intake canonical YAML writer writes any structured YAML resource
- **THEN** the caller supplies the containing directory, not the final filename
- **AND** the writer names the file `<encoded-metadata.name>.<kind>.yaml` using the exact `kind` value without case conversion
- **AND** the YAML envelope content remains authoritative for `apiVersion`, `kind`, `metadata.name`, `metadata.namespace`, and `spec`
- **AND** source modules MUST NOT override writer-owned YAML filenames

### Requirement: Import Type Registry

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

#### Scenario: Import schemas can be published

- **WHEN** `npm run publish:import-schemas` is run with `INTAKE_WORKSPACE` set
- **THEN** intake writes JSON Schema files for every supported import type under `$INTAKE_WORKSPACE/intake/schemas/policeconduct.org/intake/v1alpha1/`
- **AND** intake writes an index containing the supported import order, entity names, target tables, and import schema file paths
- **AND** publishing schemas is explicit and does not require source modules to connect to the database

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

### Requirement: Per-Source Mapping Resolution

The artifacts import pipeline MUST read source-key mappings from entity-scoped ledger files under `$INTAKE_WORKSPACE/intake/state/namespaces/<namespace>/`, where `<namespace>` is `metadata.namespace`.

#### Scenario: MN POST mapping file is selected

- **WHEN** the Artifacts envelope has `metadata.namespace: mn-post`
- **THEN** intake reads entity-scoped mapping ledger files under `$INTAKE_WORKSPACE/intake/state/namespaces/mn-post/`

#### Scenario: SourceNameToCanonicalId records are entity-scoped record ledgers

- **WHEN** a source namespace has source-key mappings
- **THEN** each entity type stores mappings in its own exact-kind directory under `$INTAKE_WORKSPACE/intake/state/namespaces/<namespace>/`
- **AND** each mapping record is stored as `<encoded-source-key>.SourceNameToCanonicalId.yaml` in that entity directory
- **AND** a kind-specific directory MUST use the exact kind value, such as `Agency`, `Personnel`, `AgencyPersonnel`, or `LocationPath`
- **AND** intake MUST NOT require a combined all-entity SourceNameToCanonicalId file
- **AND** location path mappings use the full location path as the source key
- **AND** every mapping record includes the canonical intake-owned ID used for database writes

#### Scenario: Workspace path is missing

- **WHEN** `INTAKE_WORKSPACE` is not set
- **THEN** intake fails before reading SourceNameToCanonicalId records or writing database rows

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

### Requirement: Shared Update State

The artifacts import pipeline MUST store intake-owned shared update operations outside source-specific mapping files under `$INTAKE_WORKSPACE/intake/state/shared-mutations/`.

#### Scenario: Shared agency update file path

- **WHEN** intake needs shared agency updates for canonical agency ID `<canonical-id>`
- **THEN** intake reads `$INTAKE_WORKSPACE/intake/state/shared-mutations/AgencyUpdate/<encoded-canonical-id>.AgencyUpdate.yaml`

#### Scenario: Shared personnel update file path

- **WHEN** intake needs shared personnel updates for canonical personnel ID `<canonical-id>`
- **THEN** intake reads `$INTAKE_WORKSPACE/intake/state/shared-mutations/PersonnelUpdate/<encoded-canonical-id>.PersonnelUpdate.yaml`

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

### Requirement: Durable Canonical ID Assignment

The artifacts import pipeline MUST resolve every supported source entity key to a canonical database ID before database writes, assigning new IDs with `@paralleldrive/cuid2` only through persisted mapping records.

#### Scenario: Source Artifacts do not contain canonical IDs

- **WHEN** a source module produces an `Artifacts` envelope
- **THEN** the Artifacts envelope uses canonical entity and field names derived from the current intake database schema
- **AND** source entity ID fields and source relationship fields contain source-local IDs or source-local references only
- **AND** it MUST NOT include canonical database ID values in source entity IDs or source relationship fields
- **AND** canonical IDs are resolved from environment-specific SourceNameToCanonicalId state during import
- **AND** the same source Artifacts can resolve to different canonical IDs in different workspaces only through those workspace mapping records

#### Scenario: Existing mapping record is reused

- **WHEN** a source entity has a mapping record with `canonicalId`
- **THEN** intake uses that `canonicalId` as the database row ID for the entity

#### Scenario: Missing mapping record gets canonical ID

- **WHEN** a supported source entity is missing a mapping record
- **THEN** intake creates an object mapping record for that source key and assigns `canonicalId` with `@paralleldrive/cuid2`

#### Scenario: New canonical mappings are persisted before database writes

- **WHEN** intake assigns any new canonical IDs during artifacts import
- **THEN** it persists the updated mapping file before writing any database rows

#### Scenario: Canonical mapping is missing

- **WHEN** a supported source entity mapping lacks `canonicalId` after canonical mapping resolution
- **THEN** intake fails after canonical mapping resolution and before transforming entities or writing database rows
- **AND** reports all incomplete canonical mapping records found in that validation pass instead of stopping at the first missing field

#### Scenario: Resolution fields are deferred until write-time

- **WHEN** an agency mapping record has `canonicalId` but the canonical agency record lacks `slug`, `locationPathId`, `latitude`, or `longitude`
- **THEN** intake does not fail canonical mapping validation only because those resolution fields are absent
- **AND** intake requires each absent resolution field only when the database write needs that field for an insert or update

#### Scenario: Dynamically resolvable agency fields are resolved when needed

- **WHEN** a database write needs a missing agency `slug` or `locationPathId`
- **THEN** intake attempts to resolve the missing value before failing the write
- **AND** persists any successfully resolved value to the canonical agency record
- **AND** logs the resolution outcome

#### Scenario: Entity preparation uses field-keyed resolvers

- **WHEN** intake prepares an entity for an Import
- **THEN** it calls a generic entity preparation path equivalent to `context.add(entityType, row)`
- **AND** the entity preparation path resolves missing fields through resolvers keyed by entity type and field
- **AND** the entity preparation path determines the command operation intent such as `create`, `update`, or `read` when the entity is added
- **AND** field groups such as agency `latitude` and `longitude` may share one resolver when the values come from the same source operation
- **AND** field resolution logs identify the entity type, row ID, missing fields, resolved fields, and failure reason when resolution fails

#### Scenario: Missing source location path is not created

- **WHEN** a database write needs an agency `locationPathId`
- **AND** no persisted `public.location_path_geometry` place boundary contains the resolved agency address point
- **AND** no explicit postal-area rule maps the agency address input to an existing place
- **THEN** intake fails during import preparation before database writes
- **AND** reports the agency source key, canonical ID, name, city, state, ZIP, and address point
- **AND** MUST NOT create `public.location_path` rows while resolving source agency records

#### Scenario: Agency location path is resolved from address point geometry

- **WHEN** intake resolves a missing agency `locationPathId`
- **THEN** intake resolves the agency address point from the agency address, city, state, and ZIP when coordinates are not already present
- **AND** resolves the `locationPathId` by finding the persisted `public.location_path_geometry` place boundary that contains that point
- **AND** when no place geometry contains the point, intake MAY use an explicit postal-area rule that maps the agency address input to an existing place
- **AND** the Fort Snelling postal-area rule maps Minnesota ZIP `55111` with postal city `St. Paul` or `Saint Paul` to the existing Saint Paul place path
- **AND** the Fort Snelling postal-area rule maps Minnesota ZIP `55450` with postal city `Minneapolis` to the existing Minneapolis place path
- **AND** explicit Minnesota postal-area rules map ZIP `55804` with postal city `Duluth` to the existing Duluth place path, ZIP `56270` with postal city `Morton` to the existing Morton place path, and ZIP `56241` with postal city `Granite Falls` to the existing Granite Falls place path
- **AND** fails during import preparation if no place geometry contains the point and no explicit postal-area rule maps the agency address input to an existing place
- **AND** fails during import preparation if multiple place geometries contain the point
- **AND** MUST NOT resolve agency `locationPathId` by constructing a path from city, state, administrative area, label, slug, or alias text
- **AND** MUST NOT copy location path geometry, place centroid, administrative-area centroid, or state centroid into agency `latitude` or `longitude`

#### Scenario: Location path geometry is separate from agency address coordinates

- **WHEN** intake prepares or writes a `locationPath` command
- **THEN** any `centroid` or `bbox` on that command describes the location path record itself
- **AND** `centroid` MUST be a GeoJSON `Point`
- **AND** `bbox` MUST be a GeoJSON `Polygon`
- **AND** those values are distinct from agency address `latitude` and `longitude`
- **AND** intake preserves location path geometry fields when they are present
- **AND** shared envelopes MUST NOT expose top-level location path `latitude` or `longitude`
- **AND** replay maps location path `centroid` and `bbox` envelope values to PostGIS columns on `public.location_path`

#### Scenario: Agency address coordinates are resolved independently

- **WHEN** a new agency row has a valid `locationPathId`
- **AND** either `latitude` or `longitude` is missing
- **THEN** intake resolves the missing agency address coordinates from the agency address
- **AND** does not create or replace the agency location path only because address coordinates were missing

#### Scenario: Agency address geocoding normalizes mailing fragments

- **WHEN** an agency address contains both a physical street address and a `PO Box` or mailing-address fragment
- **THEN** intake geocodes the physical street address
- **AND** preserves the original source address in the agency row

#### Scenario: Agency address geocoding may retry unresolved street addresses

- **WHEN** the batch agency address geocoder does not resolve a physical street address
- **THEN** intake may retry the same physical street address with another address-point resolver
- **AND** any resolved `latitude` and `longitude` still represent the agency address point

#### Scenario: ZIP centroids are not agency address coordinates

- **WHEN** agency address geocoding cannot resolve a physical address point
- **THEN** intake MUST NOT write a ZIP centroid, city centroid, place centroid, county centroid, or state centroid to agency `latitude` or `longitude`
- **AND** intake fails the affected agency resolution with source key, canonical ID, name, original address, city, state, and ZIP details

#### Scenario: Location path commands require complete hierarchy fields

- **WHEN** intake prepares a `locationPath` command
- **THEN** zod validation requires state paths to have no parent, administrative-area paths to include an administrative-area slug/name and state parent ID, and place paths to include administrative-area slug/name, place slug/name, and administrative-area parent ID
- **AND** intake fails during import preparation before database writes if a prepared location path is missing required hierarchy fields

#### Scenario: Prepared location path rows are unique by path

- **WHEN** multiple prepared `locationPath` commands have the same `path`
- **AND** those commands use different `location_path_id` values
- **THEN** intake fails during import preparation before database writes

#### Scenario: Cached agency location path is validated before use

- **WHEN** a new agency row has a non-empty cached canonical `locationPathId`
- **AND** the database does not contain that `public.location_path` row
- **THEN** intake fails during import preparation before resolving a replacement location path
- **AND** intake reports the missing cached canonical `locationPathId`

### Requirement: MN POST Mapping Shape

The MN POST SourceNameToCanonicalId file MUST include source-key to canonical-ID mappings only. Intake-owned resolution data MUST live in the canonical resolution cache.

SourceNameToCanonicalId files MUST be Kubernetes-style YAML resources with `apiVersion: policeconduct.org/intake/v1alpha1`, `kind: SourceNameToCanonicalId`, required `metadata.name`, required `metadata.namespace`, required `spec.kind`, and `spec.canonicalId`.

#### Scenario: Agency mapping record is complete

- **WHEN** an agency source key is imported from `mn-post`
- **THEN** its mapping record includes `canonicalId`
- **AND** the mapping file `metadata.name` equals the source key
- **AND** the mapping file `metadata.namespace` equals `mn-post`

#### Scenario: Personnel mapping record is complete

- **WHEN** a personnel source key is imported from `mn-post`
- **THEN** its mapping record includes `canonicalId`
- **AND** the mapping file `metadata.name` equals the source key
- **AND** the mapping file `metadata.namespace` equals `mn-post`

#### Scenario: Agency-personnel mapping record is complete

- **WHEN** an agency-personnel source key is imported from `mn-post`
- **THEN** its mapping record includes `canonicalId`
- **AND** the mapping file `metadata.name` equals the source key
- **AND** the mapping file `metadata.namespace` equals `mn-post`

#### Scenario: SourceNameToCanonicalId resource shape is required

- **WHEN** a SourceNameToCanonicalId YAML file is missing `apiVersion`, `kind`, `metadata.name`, `metadata.namespace`, or `spec`
- **THEN** intake rejects the SourceNameToCanonicalId file as malformed before assigning canonical IDs, transforming records, or writing database rows
- **AND** intake does not read legacy bare mapping records

### Requirement: Shared Update State Shape

Shared update state MUST store typed Kubernetes-style YAML resources. Each shared update file MUST use `apiVersion: policeconduct.org/intake/v1alpha1`, a supported update `kind`, required `metadata.name`, required `metadata.namespace`, and a `spec` object validated by that update kind.

#### Scenario: Shared location path update resource is complete

- **WHEN** intake writes a shared location path update file
- **THEN** the YAML has `kind: LocationPathUpdate`
- **AND** `metadata.name` equals the canonical location path ID
- **AND** `metadata.namespace` equals `intake`
- **AND** `spec.operations` contains ordered update operations validated against `public.location_path` fields

#### Scenario: Shared agency update resource is complete

- **WHEN** intake writes a shared agency update file
- **THEN** the YAML has `kind: AgencyUpdate`
- **AND** `metadata.name` equals the canonical agency ID
- **AND** `metadata.namespace` equals `intake`
- **AND** `spec.operations` contains ordered update operations validated against `public.agency` fields

#### Scenario: Shared personnel update resource is complete

- **WHEN** intake writes a shared personnel update file
- **THEN** the YAML has `kind: PersonnelUpdate`
- **AND** `metadata.name` equals the canonical personnel ID
- **AND** `metadata.namespace` equals `intake`
- **AND** `spec.operations` contains ordered update operations validated against `public.officers` fields

#### Scenario: Shared update resource shape is required

- **WHEN** a shared update YAML file is missing `apiVersion`, `kind`, `metadata.name`, `metadata.namespace`, or `spec`
- **THEN** intake rejects the shared update file as malformed before using it for import preparation

#### Scenario: Agency coordinates represent agency address

- **WHEN** an agency row is written from an agency mapping record
- **THEN** `latitude` and `longitude` represent the agency address point, not the location path, place centroid, county centroid, state centroid, map viewport, or any other location hierarchy geometry

#### Scenario: Agency coordinates are not dynamically copied from location paths

- **WHEN** an agency row needs `latitude` or `longitude`
- **THEN** intake MUST NOT resolve those values from `public.location_path`
- **AND** intake fails the affected row write if an agency-address coordinate source is unavailable

### Requirement: Supported Entity Transformation

The artifacts import pipeline MUST transform supported typed artifact records into rows for the current database schema using source-owned artifact fields and intake-owned mapping fields.

#### Scenario: Agency rows are transformed

- **WHEN** the Artifacts envelope contains `Agencies` records
- **THEN** intake writes database-ready rows for `public.agency` using source-owned agency fields from the Artifacts envelope, `id` from the agency mapping record, and any resolved agency mapping fields present on the agency mapping record

#### Scenario: Personnel rows are transformed

- **WHEN** the Artifacts envelope contains `Personnel` records
- **THEN** intake writes database-ready rows for `public.officers` using source-owned personnel fields from the Artifacts envelope and `id` and `slug` from the personnel mapping record

#### Scenario: Agency-personnel rows are transformed

- **WHEN** the Artifacts envelope contains `AgencyPersonnel` records
- **THEN** intake writes database-ready rows for `public.agency_officers` using source-owned roster fields from the Artifacts envelope and `id` from the agency-personnel mapping record

#### Scenario: Unsupported Artifacts fields are rejected

- **WHEN** a typed artifact record contains fields that are not supported by the current import-type schema
- **THEN** intake fails before canonical mapping resolution, transformation, or database writes

### Requirement: Relationship Key Rewriting

The artifacts import pipeline MUST rewrite relationship foreign keys from source keys to canonical database IDs before writing relationship rows.

#### Scenario: Agency-personnel agency ID is rewritten

- **WHEN** an agency-personnel entity references a source agency ID
- **THEN** the `public.agency_officers.agency_id` value is the mapped canonical agency ID

#### Scenario: Agency-personnel personnel ID is rewritten

- **WHEN** an agency-personnel entity references a source personnel ID
- **THEN** the agency-personnel artifact uses `personnel_id`
- **AND** the DatabaseMutations envelope uses `personnel_id`
- **AND** replay maps `personnel_id` to the `public.agency_officers.officer_id` database column
- **AND** the stored `public.agency_officers.officer_id` value is the mapped canonical personnel ID

#### Scenario: Agency-personnel references unmapped agency

- **WHEN** an agency-personnel entity references an agency source key without a valid agency mapping record
- **THEN** intake fails before writing database rows

#### Scenario: Agency-personnel references unmapped personnel

- **WHEN** an agency-personnel entity references a personnel source key without a valid personnel mapping record
- **THEN** intake fails before writing database rows

### Requirement: Database Write Contract

The artifacts import pipeline MUST write transformed rows directly to the database configured by `DATABASE_URL` and MUST fail loudly rather than report partial success. The intake CLI MUST load `.env` from the current working directory before running the artifacts import command, while preserving any already exported process environment values.

#### Scenario: DATABASE_URL is loaded from .env

- **WHEN** an operator runs `intake import artifacts /path/to/artifacts.yaml` from a working directory containing `.env`
- **AND** `.env` defines `DATABASE_URL`
- **AND** `DATABASE_URL` is not already exported in the process environment
- **THEN** intake uses the `.env` value as the target database URL

#### Scenario: DATABASE_URL is missing

- **WHEN** `DATABASE_URL` is not set
- **THEN** intake fails before writing database rows

#### Scenario: Exported DATABASE_URL takes precedence

- **WHEN** an operator runs `intake import artifacts /path/to/artifacts.yaml` from a working directory containing `.env`
- **AND** both `.env` and the process environment define `DATABASE_URL`
- **THEN** intake uses the process environment value as the target database URL

#### Scenario: INTAKE_WORKSPACE is loaded from .env

- **WHEN** an operator runs `intake import artifacts /path/to/artifacts.yaml` from a working directory containing `.env`
- **AND** `.env` defines `INTAKE_WORKSPACE`
- **AND** `INTAKE_WORKSPACE` is not already exported in the process environment
- **THEN** intake uses the `.env` value as the workspace root

#### Scenario: Database connection cannot be established

- **WHEN** intake cannot connect to the database configured by `DATABASE_URL`
- **THEN** intake fails before writing database rows

#### Scenario: Supported rows are written to target tables

- **WHEN** Artifacts envelope validation, mapping validation, transformation, and database connectivity all succeed
- **THEN** intake writes agency rows to `public.agency`, personnel rows to `public.officers`, and agency-personnel rows to `public.agency_officers`

#### Scenario: Database record CRU failure stops the import

- **WHEN** any database create/read/update operation fails
- **THEN** intake stops creating, reading, or updating subsequent records
- **AND** rolls back the database transaction
- **AND** reports the underlying database error

#### Scenario: Required insert fields come from cached database schema metadata

- **WHEN** intake connects to the database for a artifacts import
- **THEN** intake reads supported table column metadata once before preparing rows
- **AND** uses the cached metadata to determine which insert fields are required for the import-artifacts replay
- **AND** always treats durable row IDs as required intake-owned values even if the database column has a default

#### Scenario: New row slugs are checked before writing a ready Import

- **WHEN** intake has prepared rows for an import-artifacts replay
- **THEN** intake collects the unique slugs for new rows in each slug-bearing target table
- **AND** queries each slug-bearing target table once for existing rows with those slugs
- **AND** fails before writing a ready Import if any new row slug already belongs to a different existing row
- **AND** fails before writing a ready Import if multiple new rows for the same target table have the same slug

#### Scenario: New agency insert requires schema-required resolved agency fields

- **WHEN** intake must insert a new agency row
- **AND** cached database schema metadata says an agency field is required
- **THEN** the source entity or shared update operation must provide that field before insert
- **AND** intake attempts dynamic resolution for supported dynamic canonical fields before failing
- **AND** intake fails loudly before inserting that agency row if required fields remain absent

#### Scenario: Existing rows update owned fields only

- **WHEN** a transformed row has the same canonical ID as an existing database row
- **THEN** intake updates only the fields owned by the Artifacts envelope source or by intake mapping resolution
- **AND** intake preserves fields not owned by the Artifacts envelope source or intake mapping resolution

#### Scenario: Reimporting the same source Artifacts is refused

- **WHEN** an Import already exists for the source namespace and source Artifacts `metadata.name`
- **THEN** `intake import artifacts <artifacts-ref>` fails after reading and validating the source Artifacts and before reading mappings, preparing mutations, writing another ImportArtifacts, or writing database rows
- **AND** intake reports the existing Import path
- **AND** intake reports `intake replay import-artifacts <existing-import-artifacts-path>` as the command to replay the existing Import
- **AND** intake does not write database rows
- **AND** database state remains equivalent after the repeated import

#### Scenario: Database record CRU fails

- **WHEN** any database create/read/update operation fails
- **THEN** intake reports failure and MUST NOT report the import as successful

#### Scenario: Database-generated canonical IDs are not used

- **WHEN** intake inserts or updates an agency, personnel, or agency-personnel row
- **THEN** the canonical row ID is supplied by intake from source-key mapping resolution
- **AND** intake MUST NOT rely on the database to assign canonical IDs

### Requirement: Import Logging And Progress

The intake CLI MUST use pino to write structured import logs to `<command-name>.log` in the command directory for the command being executed and MUST use the same pino events to show human-readable progress in the terminal.

#### Scenario: Artifacts import log is command-local

- **WHEN** an operator runs `intake import artifacts /path/to/artifacts/<source-artifacts-name>.Artifacts.yaml`
- **THEN** intake creates a command folder under `$INTAKE_WORKSPACE/intake/commands/`
- **AND** intake appends structured pino log records to `<command-name>.log` in that command folder
- **AND** intake does not write the artifacts import log to any workspace-root log path

#### Scenario: Import log is command-local

- **WHEN** an operator runs `intake replay import-artifacts /path/to/command/<import-artifacts-name>.ImportArtifacts.yaml`
- **THEN** intake creates a command folder under `$INTAKE_WORKSPACE/intake/commands/`
- **AND** intake appends structured pino log records to `<command-name>.log` in that command folder
- **AND** intake does not write the Import log to any workspace-root log path

#### Scenario: Terminal progress is human-readable

- **WHEN** an operator runs `intake import artifacts /path/to/artifacts.yaml`
- **THEN** intake prints human-readable progress that includes the log file path, the Artifacts file being imported, Artifacts reading, mapping reading, mapping validation, transformation, and database writing
- **AND** the success summary reports the total number of `DatabaseMutations` applied or written
- **AND** the success summary reports record counts by parsed mutation `recordKind`, such as `LocationPath`, `LocationPathAlias`, `Agency`, `Personnel`, and `AgencyPersonnel`
- **AND** the success summary does not hard-code reporting to only agency, personnel, or agency-personnel mutations

#### Scenario: Log level controls observability

- **WHEN** `.env` or the process environment sets `LOG_LEVEL=debug`
- **THEN** intake emits debug-level pino records for Artifacts record counts, SourceNameToCanonicalId counts, transformed row counts, and DatabaseMutations counts by parsed mutation `recordKind`
- **AND** the terminal progress stream shows debug messages in human-readable form

### Requirement: Import Import Artifact

The artifacts import pipeline MUST write an intake-owned `ImportArtifacts` artifact after a successful database import so the exact resolved import can be inspected and replayed without re-running the source module.

#### Scenario: Existing Import can be replayed

- **WHEN** an operator runs `intake replay import-artifacts /path/to/<import-artifacts-name>.ImportArtifacts.yaml`
- **THEN** intake reads and validates the local `Import` file
- **AND** applies the final mutations in `spec.mutations` to the database configured by `DATABASE_URL`
- **AND** MUST NOT read SourceNameToCanonicalId records, run source modules, apply artifact mutations, or write another Import artifact

#### Scenario: ImportArtifactsDebug cannot be replayed

- **WHEN** an operator runs `intake replay import-artifacts /path/to/<debug-command-name>.ImportArtifactsDebug.yaml`
- **AND** the artifact has `kind: ImportArtifactsDebug`
- **THEN** intake fails before writing database rows

#### Scenario: Optional artifact mutations are applied before transformation

- **WHEN** `<command-id>.ArtifactMutations.yaml` exists in the source command folder containing the source `Artifacts` file being imported
- **THEN** intake loads and validates the mutation collection after reading the source Artifacts and before transforming source entities
- **AND** the mutation collection uses `kind: ArtifactMutations`
- **AND** the mutation collection uses `metadata.namespace: manual`
- **AND** the mutation collection uses `metadata.name` equal to the source Artifacts `metadata.name`
- **AND** `ArtifactMutations.spec.mutations` contains an ordered array of inline target mutations or relative `ref` items
- **AND** each inline mutation or referenced `ArtifactMutation` uses `spec.target.namespace` matching the source Artifacts `metadata.namespace`
- **AND** each inline mutation or referenced `ArtifactMutation` uses `spec.target.command.name` matching the source Artifacts `metadata.name`
- **AND** each inline mutation or referenced `ArtifactMutation` uses `spec.target.kind` as the exact singular record kind targeted by the mutation
- **AND** each inline mutation or referenced `ArtifactMutation` uses `spec.target.name` as the targeted record name within that command, namespace, and kind
- **AND** each inline mutation or referenced `ArtifactMutation` contains an ordered `operations` array for that one target
- **AND** mutation `ref` values are resolved relative to the `ArtifactMutations` file and must not be absolute or escape that command folder
- **AND** intake applies `ArtifactMutations.spec.mutations` in listed order before source entity transformation
- **AND** `set` operations require `path`, `value`, and `reason`
- **AND** agency mutation paths MAY include dotted future source enrichment fields such as `urls.website`, `phones.main`, `phones.fax`, `urls.facebook`, `addresses.physical`, or `addresses.mailing` only when the current import-type schema supports those fields
- **AND** per-operation evidence is for external mutation evidence and MUST NOT duplicate the source artifacts path
- **AND** mutation operation schemas MAY omit `value` for future operations where no value is meaningful
- **AND** the source Artifacts file is not modified
- **AND** the resulting `ImportArtifacts` mutations contain the final transformed rows after artifact mutation application, not the source artifact mutation operations themselves
- **AND** `Import` metadata records the mutation file path and digest

#### Scenario: Missing optional artifact mutation file is not an error

- **WHEN** no matching artifact mutation file exists for the source Artifacts being imported
- **THEN** intake continues with the unmodified source Artifacts

#### Scenario: Successful import writes ImportArtifacts envelope

- **WHEN** a artifacts import writes database rows successfully
- **THEN** intake creates a new unique cuid2 ImportArtifacts ID
- **AND** intake writes `$INTAKE_WORKSPACE/intake/commands/<timestamp>-<import-artifacts-name>/<import-artifacts-name>.ImportArtifacts.yaml`
- **AND** the containing command folder begins with the intake-created timestamp followed by the ImportArtifacts ID
- **AND** the YAML filename is writer-owned and follows `<encoded-metadata.name>.ImportArtifacts.yaml`
- **AND** the artifact includes ImportArtifacts ID, source Artifacts ID, intake creation timestamp, source namespace, source artifacts path, source artifacts digest, row counts, and status under top-level `metadata`
- **AND** the artifact includes an ordered `spec.mutations` array
- **AND** executable import mutations are not mixed with bookkeeping metadata

#### Scenario: Import mutations preserve apply order

- **WHEN** an `ImportArtifacts` artifact is written
- **THEN** `spec.mutations` contains the exact database create/read/update operations in execution order
- **AND** each mutation uses a kind-specific mutation kind such as `AgencyCreate` or `AgencyUpdate`
- **AND** each inline mutation includes the mutation kind, target record name, and `spec` row payload
- **AND** automatically resolved values used during preparation are present in the final mutation row payloads
- **AND** automatically resolved values are also recorded under `metadata.preparationMutations` as ordered mutation items with action, entity type, row ID, optional source key, path, value, and reason
- **AND** deleting and regenerating an `Import` may rerun automatic resolution unless those values have been preserved in durable source input, canonical state, or a artifact mutation
- **AND** operation values are one of `create`, `read`, `update`, `delete`, or `list`
- **AND** the mutation kind records mutation intent at mutation creation time, not a guarantee of which SQL branch a later replay will use
- **AND** replay code derives the target table from the mutation record kind
- **AND** default owned-column metadata is stored under top-level `metadata.ownedColumns` keyed by entity type
- **AND** a mutation includes `ownedColumns` only when its ownership differs from the metadata default for its entity type
- **AND** replay code applies mutations in array order so replay does not recalculate database dependency order
- **AND** a mutation MAY be externalized as a relative `ref` to a kind-specific mutation envelope
- **AND** mutation `ref` values are resolved relative to the `ImportArtifacts` file that declares them
- **AND** absolute mutation `ref` values and parent-directory traversal are rejected
- **AND** a kind-specific mutation envelope uses `apiVersion: policeconduct.org/intake/v1alpha1`, a mutation kind such as `AgencyCreate`, required `metadata.name`, required `metadata.namespace`, and a `spec` row payload

#### Scenario: ImportArtifacts filenames preserve replay order

- **WHEN** multiple `ImportArtifacts` artifacts are written
- **THEN** their command folder names begin with sortable UTC timestamps
- **AND** include the ImportArtifacts ID after the timestamp
- **AND** each command folder contains an `ImportArtifacts` YAML file named `<encoded-import-artifacts-name>.ImportArtifacts.yaml`
- **AND** applying all command folders in `$INTAKE_WORKSPACE/intake/commands/` in lexical folder-name order reproduces the import order across namespaces

#### Scenario: ImportArtifacts source artifacts digest is metadata

- **WHEN** an `ImportArtifacts` artifact is written
- **THEN** `metadata.sourceArtifactsDigest` is the SHA-256 digest of the source Artifacts file contents
- **AND** the digest is not part of the Import filename

#### Scenario: ImportArtifacts records database schema identity

- **WHEN** an `ImportArtifacts` or `ImportArtifactsDebug` artifact is written
- **THEN** `metadata.databaseSchema.appliedMigrations` records the applied Supabase migrations visible to the importer when the command artifact was prepared
- **AND** the schema identity is metadata and not part of `spec.mutations`

#### Scenario: Test import-artifacts replay workspace is isolated

- **WHEN** tests write import-artifacts replay artifacts
- **THEN** `INTAKE_WORKSPACE_TEST` can override the workspace root used for those artifacts

#### Scenario: Preparation failure writes debug artifact

- **WHEN** import command preparation fails before a successful `Import` can be written
- **THEN** intake continues preparation where possible and reports all row preparation errors found in that pass
- **AND** intake creates a new unique cuid2 debug command ID
- **AND** intake writes `$INTAKE_WORKSPACE/intake/commands/<timestamp>-<debug-command-id>/<debug-command-id>.ImportArtifactsDebug.yaml`
- **AND** the debug artifact uses `kind: ImportArtifactsDebug` so replay/import code MUST NOT treat it as an executable `ImportArtifacts`
- **AND** the debug artifact includes ImportArtifacts ID, source Artifacts ID, intake creation timestamp, source namespace, source artifacts path, source artifacts digest, row counts, status, and preparation errors under top-level `metadata`
- **AND** the debug artifact includes an ordered `spec.mutations` array

#### Scenario: ImportArtifacts includes Artifacts-provided location paths

- **WHEN** an `Artifacts` envelope contains `LocationPaths` records
- **THEN** each location path row is included in the `ImportArtifacts` artifact as a mutation with `kind: LocationPath`
- **AND** location path mutations appear before alias or agency mutations that reference them
- **AND** source agency resolution MUST NOT add additional location path mutations that were absent from the transformed Artifacts rows

#### Scenario: Location path source IDs are rewritten through mappings

- **WHEN** an `Artifacts` envelope contains `LocationPaths` records
- **THEN** each location path record key and `location_path_id` value is the source location path path
- **AND** each location path record key is the source-row key used for the SourceNameToCanonicalId ledger
- **AND** each non-null `parent_location_path_id` value is resolved as the parent source-row key
- **AND** optional `centroid` and `bbox` values are preserved as location path geometry
- **AND** intake rewrites both the row ID and parent ID through the SourceNameToCanonicalId ledger before writing `public.location_path`
- **AND** intake fails before database writes if a location path references an unmapped parent source key

#### Scenario: Existing location path path conflicts with mapped ID

- **WHEN** a source `LocationPaths` record maps to a canonical `location_path_id`
- **AND** the database already has the same `path` with a different `location_path_id`
- **THEN** mutation planning fails before writing or applying DatabaseMutations
- **AND** intake reports both the existing database `location_path_id` and the mapped import `location_path_id`

#### Scenario: ImportArtifacts includes location path aliases

- **WHEN** an import-artifacts replay contains `LocationPathAlias` mutations
- **THEN** each alias mutation writes `public.location_path_alias.alias_path` and `public.location_path_alias.location_path_id`
- **AND** `alias_path` is unique
- **AND** the alias mutation appears after the canonical `LocationPath` mutation it references and before mutations that may need the alias

#### Scenario: Baseline location imports are authoritative

- **WHEN** a baseline location import has loaded canonical location paths for an area
- **THEN** later source imports resolve agency location paths from persisted `public.location_path_geometry` place containment against the resolved agency address point
- **AND** the containing boundary's `location_path_id` must identify an existing `public.location_path` place row
- **AND** explicit postal-area rules may map address input to an existing place only after place containment finds no match
- **AND** a missing source location fails as not found instead of dynamically creating a new place
- **AND** the operator can fix the miss by running an earlier baseline import that writes the correct location path geometry boundary and referenced canonical location path before the source import

#### Scenario: Canonical-only location paths do not satisfy source imports

- **WHEN** a location path exists in the canonical workspace cache
- **AND** the connected database does not contain that location path
- **THEN** source agency imports fail with a missing location path error
- **AND** intake does not materialize the canonical-only location path as part of the source agency import
- **AND** the operator can create an earlier baseline location `Artifacts` import to make the location available

#### Scenario: ImportArtifacts output directory is not writable

- **WHEN** intake cannot create or write the `ImportArtifacts` artifact directory
- **THEN** intake reports `ImportArtifacts output directory is not writable: <path>`
- **AND** intake MUST NOT report the import as successful

### Requirement: Initial MN POST Mapping Setup

The implementation MUST seed the initial MN POST SourceNameToCanonicalId records in intake-owned workspace state under `$INTAKE_WORKSPACE/intake/state/namespaces/mn-post/` as setup data, not as a generated product feature.

#### Scenario: Known seeded agency mapping is present

- **WHEN** `$INTAKE_WORKSPACE/intake/state/namespaces/mn-post/Agency/a2j40000000crR2AAI.SourceNameToCanonicalId.yaml` is created
- **THEN** it maps agency source key `a2j40000000crR2AAI` to canonical ID `cm90a1b2c3d4e5f6g7h8i9j1l`

#### Scenario: Known seeded personnel mappings are present

- **WHEN** initial MN POST personnel mapping records are created under `$INTAKE_WORKSPACE/intake/state/namespaces/mn-post/Personnel/`
- **THEN** they include personnel source keys `003t000000MgMrLAAV` and `0034000001mtGzaAAE` mapped to their known canonical IDs

#### Scenario: Known seeded agency-personnel mappings are present

- **WHEN** initial MN POST agency-personnel mapping records are created under `$INTAKE_WORKSPACE/intake/state/namespaces/mn-post/AgencyPersonnel/`
- **THEN** it includes agency-personnel source keys `a2mt0000000ncuQAAQ` and `a2m40000000oVI3AAM` mapped to their known canonical IDs from current seed data

#### Scenario: No mapping generator command is exposed

- **WHEN** the initial MN POST mapping file is created
- **THEN** intake does not add a user-facing CLI command for generating mapping files
