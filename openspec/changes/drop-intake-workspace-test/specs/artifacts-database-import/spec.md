## MODIFIED Requirements

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

- **WHEN** a test sets `INTAKE_WORKSPACE` to its own temporary folder and runs the artifacts import, which writes its `ImportArtifacts` artifact (in the code, a `DatabaseMutations` file in a command folder)
- **THEN** the artifact is written under that folder
- **AND** when `INTAKE_WORKSPACE_TEST` is also set, the import fails before it writes anything, with `INTAKE_WORKSPACE_TEST is no longer read; unset it and set INTAKE_WORKSPACE.`

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
