## ADDED Requirements

### Requirement: Manifest Import Command

The intake CLI MUST provide `intake import manifest <manifest-ref>` to import an existing local `ImportPackage` manifest without running a source module.

#### Scenario: Operator imports a local manifest

- **WHEN** an operator runs `intake import manifest /path/to/manifest.yaml`
- **THEN** intake reads the manifest from the provided local path and uses the direct manifest import pipeline

#### Scenario: Manifest import does not run source modules

- **WHEN** an operator runs `intake import manifest /path/to/manifest.yaml`
- **THEN** intake MUST NOT invoke any source module command or source-module orchestration

#### Scenario: Manifest command validates argument count

- **WHEN** an operator runs `intake import manifest` without a manifest path or with extra positional arguments
- **THEN** intake fails without reading mappings or writing database rows

### Requirement: ImportPackage Validation

The manifest import pipeline MUST validate the manifest before reading source mappings or writing database rows.

#### Scenario: Manifest path is unreadable

- **WHEN** the manifest path is missing, unreadable, or not a file
- **THEN** intake fails before reading source mappings or writing database rows

#### Scenario: Manifest YAML is malformed

- **WHEN** the manifest file cannot be parsed as YAML
- **THEN** intake fails before reading source mappings or writing database rows

#### Scenario: Manifest apiVersion or kind is unsupported

- **WHEN** the manifest does not use supported `apiVersion: policeconduct.org/intake/v1alpha1` and `kind: ImportPackage`
- **THEN** intake fails before reading source mappings or writing database rows

#### Scenario: Manifest namespace is missing

- **WHEN** `metadata.namespace` is missing or empty
- **THEN** intake fails before reading source mappings or writing database rows

### Requirement: Per-Source Mapping Resolution

The manifest import pipeline MUST read source-key mappings from `$INTAKE_WORKSPACE/intake/sources/<namespace>/`, where `<namespace>` is `metadata.namespace`.

#### Scenario: MN POST mapping file is selected

- **WHEN** the manifest has `metadata.namespace: mn-post`
- **THEN** intake reads `$INTAKE_WORKSPACE/intake/sources/mn-post/` as the source mapping file

#### Scenario: Mapping file is unreadable

- **WHEN** the required mapping file is missing, unreadable, or malformed
- **THEN** intake fails before writing database rows

#### Scenario: Mapping records use entity object maps

- **WHEN** intake reads a mapping file
- **THEN** it expects object maps under `agencies`, `personnel`, and `agencyPersonnel` keyed by source entity ID

### Requirement: Durable Canonical ID Assignment

The manifest import pipeline MUST resolve every supported source entity key to a canonical database ID before database writes, assigning new IDs with `@paralleldrive/cuid2` only through persisted mapping records.

#### Scenario: Existing mapping record is reused

- **WHEN** a source entity has a mapping record with `canonicalId`
- **THEN** intake uses that `canonicalId` as the database row ID for the entity

#### Scenario: Missing mapping record gets canonical ID

- **WHEN** a supported source entity is missing a mapping record
- **THEN** intake creates an object mapping record for that source key and assigns `canonicalId` with `@paralleldrive/cuid2`

#### Scenario: New canonical mappings are persisted before database writes

- **WHEN** intake assigns any new canonical IDs during manifest import
- **THEN** it persists the updated mapping file before writing any database rows

#### Scenario: Required intake-owned mapping field is missing

- **WHEN** a mapping record lacks a required intake-owned field needed for its database row
- **THEN** intake fails before writing database rows

### Requirement: MN POST Mapping Shape

The MN POST source mapping file MUST include all intake-owned resolution data required to write supported MN POST entity rows.

#### Scenario: Agency mapping record is complete

- **WHEN** an agency source key is imported from `mn-post`
- **THEN** its mapping record includes `canonicalId`, `slug`, `locationPathId`, `latitude`, and `longitude`

#### Scenario: Personnel mapping record is complete

- **WHEN** a personnel source key is imported from `mn-post`
- **THEN** its mapping record includes `canonicalId` and `slug`

#### Scenario: Agency-personnel mapping record is complete

- **WHEN** an agency-personnel source key is imported from `mn-post`
- **THEN** its mapping record includes `canonicalId`

#### Scenario: Agency coordinates represent agency address

- **WHEN** an agency row is written from an agency mapping record
- **THEN** `latitude` and `longitude` represent the agency address point, not the location path or place centroid

### Requirement: Supported Entity Transformation

The manifest import pipeline MUST transform supported manifest entities into rows for the current database schema using source-owned manifest fields and intake-owned mapping fields.

#### Scenario: Agency rows are transformed

- **WHEN** the manifest contains `spec.entities.agencies`
- **THEN** intake writes database-ready rows for `public.agency` using source-owned agency fields from the manifest and `id`, `slug`, `location_path_id`, `latitude`, and `longitude` from the agency mapping record

#### Scenario: Personnel rows are transformed

- **WHEN** the manifest contains `spec.entities.personnel`
- **THEN** intake writes database-ready rows for `public.officers` using source-owned personnel fields from the manifest and `id` and `slug` from the personnel mapping record

#### Scenario: Agency-personnel rows are transformed

- **WHEN** the manifest contains `spec.entities.agencyPersonnel`
- **THEN** intake writes database-ready rows for `public.agency_officers` using source-owned roster fields from the manifest and `id` from the agency-personnel mapping record

#### Scenario: Unsupported manifest fields are ignored

- **WHEN** a manifest entity contains fields that are not supported by the current database schema
- **THEN** intake ignores those fields for database writes unless this change explicitly adds schema support

### Requirement: Relationship Key Rewriting

The manifest import pipeline MUST rewrite relationship foreign keys from source keys to canonical database IDs before writing relationship rows.

#### Scenario: Agency-personnel agency ID is rewritten

- **WHEN** an agency-personnel entity references a source agency ID
- **THEN** the `public.agency_officers.agency_id` value is the mapped canonical agency ID

#### Scenario: Agency-personnel officer ID is rewritten

- **WHEN** an agency-personnel entity references a source personnel ID
- **THEN** the `public.agency_officers.officer_id` value is the mapped canonical officer ID

#### Scenario: Agency-personnel references unmapped agency

- **WHEN** an agency-personnel entity references an agency source key without a valid agency mapping record
- **THEN** intake fails before writing database rows

#### Scenario: Agency-personnel references unmapped personnel

- **WHEN** an agency-personnel entity references a personnel source key without a valid personnel mapping record
- **THEN** intake fails before writing database rows

### Requirement: Database Write Contract

The manifest import pipeline MUST write transformed rows directly to the database configured by `DATABASE_URL` and MUST fail loudly rather than report partial success.

#### Scenario: DATABASE_URL is missing

- **WHEN** `DATABASE_URL` is not set
- **THEN** intake fails before writing database rows

#### Scenario: Database connection cannot be established

- **WHEN** intake cannot connect to the database configured by `DATABASE_URL`
- **THEN** intake fails before writing database rows

#### Scenario: Supported rows are written to target tables

- **WHEN** manifest validation, mapping validation, transformation, and database connectivity all succeed
- **THEN** intake writes agency rows to `public.agency`, personnel rows to `public.officers`, and agency-personnel rows to `public.agency_officers`

#### Scenario: Database write fails

- **WHEN** any database write fails
- **THEN** intake reports failure and MUST NOT report the import as successful

#### Scenario: Duplicate rows are not hidden

- **WHEN** a transformed row violates a primary key, unique key, foreign key, or other database constraint
- **THEN** intake fails loudly and MUST NOT hide the conflict with `ON CONFLICT`, upsert, or `DO NOTHING`

### Requirement: Initial MN POST Mapping Setup

The implementation MUST add the initial `$INTAKE_WORKSPACE/intake/sources/mn-post/` needed by the current MN POST manifest as setup data, not as a generated product feature.

#### Scenario: Known seeded agency mapping is present

- **WHEN** `$INTAKE_WORKSPACE/intake/sources/mn-post/` is created
- **THEN** it includes agency source key `a2j40000000crR2AAI` mapped to canonical ID `cm90a1b2c3d4e5f6g7h8i9j1l`, slug `minnesota-state-patrol-d4e5f6`, location path ID `c8gr6bl9bb9i9rmwgo95gord`, latitude `44.9486036`, and longitude `-93.0953582`

#### Scenario: Known seeded personnel mappings are present

- **WHEN** `$INTAKE_WORKSPACE/intake/sources/mn-post/` is created
- **THEN** it includes personnel source keys `003t000000MgMrLAAV` and `0034000001mtGzaAAE` mapped to their known canonical IDs and slugs from current seed data

#### Scenario: Known seeded agency-personnel mappings are present

- **WHEN** `$INTAKE_WORKSPACE/intake/sources/mn-post/` is created
- **THEN** it includes agency-personnel source keys `a2mt0000000ncuQAAQ` and `a2m40000000oVI3AAM` mapped to their known canonical IDs from current seed data

#### Scenario: No mapping generator command is exposed

- **WHEN** the initial MN POST mapping file is created
- **THEN** intake does not add a user-facing CLI command for generating mapping files
