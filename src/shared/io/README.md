# io

## Overview

The canonical IO for intake YAML envelopes that more than one command uses.
Each kind has one module that owns its schema, constructor, reader, and
writer, exposed as a const object named after the kind (`Command`,
`Artifacts`, `PropertyCorrection`, and so on) with `kind`, `schema`, `new`,
`read`, and `write` members. Hand-written modules here cover the kinds
`Artifacts`, `BinaryFile`, `CallResult`, `Command`, `IdentityRestoration`,
`InitialAgencyRoots`, `PropertyCorrection`, `RecordsRequest`, and the read-only source-scoped
`ResolvedProperty`. The per-entity artifact kinds are generated into
this folder (see [Generated Artifact IO](#generated-artifact-io) below). The envelope IO
modules read, parse, and write files through [`./internal/`](./internal/README.md). Two
modules do their own file work: `excluded-records.ts` uses `yaml` and
`node:fs/promises` directly for `excluded.yaml`, which is not an envelope, and
`RecordsRequest.ts` calls `rename` itself to replace the file it wrote.

This directory also holds the import type registry (the importable artifact
kinds, their dependency order, and the names of mutation kinds), the loaders
for a source's `excluded.yaml` file and for `PropertyCorrection` envelopes,
and the file-naming and digest helpers.

## Interface

Module entry point:

- `index.ts` re-exports the items marked "(index)" below and, from the
  generated modules, most per-entity envelope IO objects, specs, and types. It
  defines nothing itself. It does not re-export these names of the generated
  modules:
  - The IO objects `Reviews`, `ReviewPersonnel`, `ReviewLinks`,
    `CoverageHomepageWindows`, `CoverageHomepagePlacements`,
    `PersonnelRecord`, and `AgencyPersonnelRecord`.
  - The specs `ReviewSpec`, `ReviewPersonnelSpec`, `ReviewLinkSpec`,
    `ArrestProfileSpec`, `CoverageHomepageWindowSpec`, and
    `CoverageHomepagePlacementSpec`.
  - The `Envelope` and `Input` types of `PersonnelRecord`,
    `AgencyPersonnelRecord`, `PersonnelPhotos`, `Disciplines`,
    `DisciplineAgencyPersonnel`, `CoverageHomepageWindows`,
    `CoverageHomepagePlacements`, `CoverageLinks`,
    `CoverageLinkAgencyPersonnel`, `AgencyPhoneNumbers`, `FederalAgencies`,
    `CivilCases`, `CivilCasePersonnel`, `CivilCaseLinks`, `Reviews`,
    `ReviewPersonnel`, `ReviewLinks`, `ArrestProfiles`, and
    `AgencyArrestProfiles`.

Envelope IO objects:

- `Artifacts.ts:Artifacts` (index): IO for kind `Artifacts`.
  `Artifacts.read(filePath, options)` returns the envelope with every
  `spec.artifacts` item resolved to `{ kind, spec, recordSources }` and sorted
  by `import-types.ts:compareImportArtifactKinds`; `raw: true` returns it as
  stored and `includeKinds` filters it. `Artifacts.write(directory, envelope)`
  writes each inline artifact item to per-kind files in `directory`, stores a
  `ref` (`path`, `kind`, `sha256`) to each, passes an item that is already a
  `ref` through unchanged, and returns `{ path }` only.
  `Artifacts.integrityDigest` returns a hex sha256 over the
  Artifacts file and every referenced artifact and record file.
  `Artifacts.digest` returns `sha256:<hex>` of the Artifacts file.
- `Artifacts.ts:ArtifactsEnvelope` (index),
  `Artifacts.ts:ArtifactsInput` (index),
  `Artifacts.ts:ImportArtifactEnvelope` (index),
  `Artifacts.ts:ArtifactsArtifactReference`: types for the resolved Artifacts
  envelope, one per-kind artifact envelope, and one stored `spec.artifacts`
  item. The module also re-exports the type `ImportArtifactKind`.
  `ArtifactsInput` is the type `new` takes.
- `Command.ts:Command` (index): IO for kind `Command`. `read(filePath,
{ expectedNamespace, expectedSha256 })`; `write(directory, envelope)`
  returns `{ path, sha256 }`. Also `Command.ts:schema`,
  `Command.ts:CommandEnvelope` (index), `Command.ts:CommandInput` (index),
  and the aliases `Command.ts:read` and `Command.ts:write`.
- `IdentityRestoration.ts:IdentityRestoration`: IO for kind
  `IdentityRestoration` (`spec.entityKind`, `spec.sourceName`,
  `spec.expectedCurrentId`, `spec.originalId`, `spec.reason`,
  `spec.evidence`, all required). `read(filePath)` takes no options;
  `write(directory, envelope)` returns `{ path }` without `sha256`. Also
  `IdentityRestoration.ts:IdentityRestorationEnvelope`. Not re-exported by
  `index.ts`.
- `CallResult.ts:CallResult` (index): IO for kind `CallResult` (ADR 0039):
  `spec.request` (`service`, `operation`, optional `url`,
  `parameters`, `prompt`, `inputs` of `{ name, sha256 }`) and `spec.outcomes`,
  each with `status`, `startedAt`, `completedAt`, `commandId`,
  `intakeVersion` and optional `response`, `file`, `error`
  (`{ kind: "item" | "service", message }`), `httpStatus`, `requestId`,
  `stopReason`, `requestedModel`, `model`, `usage`, `retryAfter`,
  `producedBy`. `read(filePath)`;
  `write(directory, envelope)` returns `{ path }`. Also
  `CallResult.ts:callRequestFingerprint(request)`, and the types
  `CallResult.ts:CallRequest`, `CallResult.ts:CallOutcome`,
  `CallResult.ts:CallResultEnvelope` and `CallResult.ts:CallResultInput`
  (all index).
- `BinaryFile.ts:BinaryFile` (index): IO for kind `BinaryFile` (ADR 0039):
  `spec.sha256`, `spec.bytes`, `spec.contentType`, `spec.extension` and
  `spec.origin`, which is `{ kind: "download", url, retrievedAt, httpStatus }`
  or `{ kind: "local", filename, importedAt }`. `read(envelopePath)` returns
  `BinaryFile.ts:StoredBinaryFile`: `{ envelope, bytes, filePath }`.
  `write(directory, envelope, bytes)` returns `{ path, filePath }`. Also the
  types `BinaryFile.ts:BinaryFileEnvelope`, `BinaryFile.ts:BinaryFileInput`
  and `BinaryFile.ts:BinaryFileOrigin` (all index).
- `fingerprint.ts:typedInputFingerprint(value)` returns the sha256 of the
  value's stable JSON, which `fingerprint.ts:stableJson(value)` writes with
  object keys sorted.
- `InitialAgencyRoots.ts:InitialAgencyRoots` (index): IO for kind
  `InitialAgencyRoots` (`spec.agencySourceNames`). Also
  `InitialAgencyRoots.ts:schema`,
  `InitialAgencyRoots.ts:InitialAgencyRootsEnvelope` (index),
  `InitialAgencyRoots.ts:InitialAgencyRootsInput` (index), and the aliases
  `InitialAgencyRoots.ts:read` and `InitialAgencyRoots.ts:write`.
- `PropertyCorrection.ts:PropertyCorrection` (index): IO for kind
  `PropertyCorrection` (`spec.subject`, `spec.targetProperty`,
  `spec.entries`). `read(filePath, { getLocationPathById, expectedNamespace,
expectedSha256 })`; `write(directory, envelope, { getLocationPathById })`
  returns `{ path, sha256 }`. Also `PropertyCorrection.ts:schema`,
  `PropertyCorrection.ts:PropertyCorrectionEnvelope`,
  `PropertyCorrection.ts:PropertyCorrectionInput`,
  `PropertyCorrection.ts:correctionValue` (the entry's value, or `null` for an
  `unset` entry), and the aliases `PropertyCorrection.ts:read` and
  `PropertyCorrection.ts:write`.
- `RecordsRequest.ts:RecordsRequest` (index): IO for kind `RecordsRequest`.
  `read(file)` takes no options; `write(directory, input)` returns
  `{ path, sha256 }`. Also `RecordsRequest.ts:RecordsRequestEnvelope` (index),
  `RecordsRequest.ts:payloadSchema`, `RecordsRequest.ts:RequestPayload`,
  `RecordsRequest.ts:portalContactSchema`, `RecordsRequest.ts:PortalContact`.
- `SourceScopedResolvedProperty.ts:SourceScopedResolvedProperty`: read-only
  IO for the historical source-scoped `ResolvedProperty` envelope;
  `read(file)` returns `{ contents, envelope }`.

Loaders and state helpers:

- `initial-agency-roots.ts:initialAgencyRootsDirectory(root, namespace)`
  (index) returns
  `<root>/intake/state/namespaces/<namespace>/InitialAgencyRoots`.
- `initial-agency-roots.ts:loadInitialAgencyRoots(root, namespace)` (index)
  returns that folder's `initial` envelope, or `undefined` when the file does
  not exist.
- `excluded-records.ts:loadExcludedRecords(stateDir)` (index) reads
  `<stateDir>/excluded.yaml` into an `excluded-records.ts:ExcludedRecords`
  (index) map; `excluded-records.ts:excludedRecordKey(kind, sourceKey)`
  (index) builds its keys. `excluded-records.ts:ExcludedRecord` (index) is
  one entry.
- `excluded-records.ts:appendExcludedRecord(stateDir, record, { replace })`
  adds or replaces one entry in `<stateDir>/excluded.yaml` and returns the
  file path.
- `property-corrections.ts:loadPropertyCorrections(root, namespace, log,
getLocationPathById)` (index) reads every `PropertyCorrection` of a
  namespace and returns a
  `property-corrections.ts:ApplyPropertyCorrections` (index) function,
  `(kind, sourceId, spec, applied) => spec`.
  - The function applies the active entry to a copy of the record's spec when
    the current value deep-equals the entry's `from`. A `from` of `null`
    matches both `null` and `undefined`.
  - For each correction it applies, it calls the optional
    `applied(property, annotation)` with a
    `src/shared/data-annotations.ts:CorrectionAnnotation`.
  - When `root` is `undefined` the loader reads nothing and returns a
    function that returns the spec unchanged. A missing folder yields no
    corrections.
- `property-corrections.ts:setPropertyCorrection(input)` writes a
  `PropertyCorrection` with a new active entry.
- `property-corrections.ts:inspectPropertyCorrection(root, namespace, kind,
sourceId, property, getLocationPathById)` reads one `PropertyCorrection`,
  or returns `undefined` when its file does not exist. The optional
  `getLocationPathById` is passed to `PropertyCorrection.read`.
- `property-corrections.ts:correctionPropertySchema(kind, property)` returns
  the schema of one property of a generated `<kind>Spec`.

Import type registry:

- `intake-api-version.ts:INTAKE_API_VERSION` is
  `policeconduct.org/intake/v1alpha1`.
- `import-operations.ts:IMPORT_OPERATIONS` (`create`, `read`, `update`),
  `import-operations.ts:ImportOperation`, and
  `import-operations.ts:IMPORT_OPERATION_SUFFIXES` (`Create`, `Read`,
  `Update`).
- `import-type-metadata.ts:ImportTypeMetadata` (`kind`, `recordKind`,
  `entityName`, `targetTable`, `dependsOn`); the module re-exports
  `IMPORT_ARTIFACT_KINDS`, `importTypeMetadata`, `ImportArtifactKind`, and
  `ImportEntityName` from `./entity-specs.ts`, and
  `IMPORT_OPERATIONS`, `IMPORT_OPERATION_SUFFIXES`, and `ImportOperation`
  from `./import-operations.ts`.
- `import-types.ts:importTypeRegistry` maps each artifact kind to its
  metadata plus `recordSchema`
  (`import-types.ts:ImportTypeDefinition`). The module re-exports
  `INTAKE_API_VERSION`, `IMPORT_ARTIFACT_KINDS`, `IMPORT_OPERATIONS`,
  `IMPORT_OPERATION_SUFFIXES`, and the types `ImportArtifactKind` (index),
  `ImportEntityName`, and `ImportOperation`.
- `import-types.ts:importArtifactKindOrder()` returns the artifact kinds with
  every kind after the kinds it depends on;
  `import-types.ts:compareImportArtifactKinds` compares two kinds by that
  order.
- `import-types.ts:mutationKindForRecordKind(operation, recordKind)` builds a
  mutation kind such as `AgencyCreate`;
  `import-types.ts:parseMutationKind` splits one back into `operation` and
  `recordKind`; `import-types.ts:IMPORT_MUTATION_KINDS` lists them all.
- `import-types.ts:sourceNameForImportRecord(recordName, record)` returns
  `recordName`.

File naming and digests:

- `resource.ts:yamlResourceFileName(id, kind)` (index) returns
  `<encodeURIComponent(id)>.<kind>.yaml`;
  `resource.ts:yamlResourcePath(directory, resource)` joins it to a directory
  using `metadata.name` and `kind`. `resource.ts:YamlResource` is the input
  type.
- `resource.ts:yamlDigest(contents)` returns the hex sha256 of a string.
- `resource.ts:firstIssuePath(error)` returns the dotted path of the first
  zod issue, or `record` when that path is empty. For an `unrecognized_keys`
  issue it appends the first unknown key to the path.

Subdirectories:

- [internal](./internal/README.md): YAML document read, parse, write, and
  digest functions.

## Invariants

- Every envelope schema requires `apiVersion` to equal
  `intake-api-version.ts:INTAKE_API_VERSION` and `kind` to equal its own kind
  as zod literals, and rejects unknown keys in the envelope, `metadata`, and
  `spec`: `Command.ts:schema`, `InitialAgencyRoots.ts:schema`,
  `PropertyCorrection.ts:schema`,
  `CallResult.ts:CallResult` and `BinaryFile.ts:BinaryFile` (`schema`
  members),
  `IdentityRestoration.ts:IdentityRestoration` (`schema` member),
  `RecordsRequest.ts:RecordsRequest` (`schema` member),
  `SourceScopedResolvedProperty.ts:SourceScopedResolvedProperty` (`read`).
- `new`, `read`, and `write` of each IO object all validate against the
  schema. `Command.ts:Command`, `InitialAgencyRoots.ts:InitialAgencyRoots`,
  `CallResult.ts:CallResult`, `BinaryFile.ts:BinaryFile`,
  and `PropertyCorrection.ts:PropertyCorrection` throw
  `<Kind> is malformed at <path>.`;
  `IdentityRestoration.ts:IdentityRestoration`,
  `RecordsRequest.ts:RecordsRequest`, and
  `SourceScopedResolvedProperty.ts:SourceScopedResolvedProperty` (`read`
  only) throw the `ZodError`.
- `Command.ts:Command`, `InitialAgencyRoots.ts:InitialAgencyRoots`, and
  `PropertyCorrection.ts:PropertyCorrection` `read` throw on a sha256 mismatch
  when `expectedSha256` is given and on a namespace mismatch when
  `expectedNamespace` is given.
- `IdentityRestoration.ts:IdentityRestoration`: `spec.entityKind` must be a
  key of the generated `TABLE_BY_KIND`, and `spec.expectedCurrentId` must
  differ from `spec.originalId`.
- `CallResult.ts:CallResult`: `metadata.name` is
  `callRequestFingerprint(spec.request)`. A request is rejected when a key
  anywhere in `parameters` is named like a credential (`authorization`,
  `cookie`, `x-api-key`, `api_key`, `token`, `password`, `secret`), or when
  its `url` has a user, a password or a query parameter with such a name. A
  succeeded outcome has exactly one of `response` and `file` and no `error`;
  a failed outcome has an `error` and neither. `spec.outcomes` has at least
  one entry. `write` throws
  `CallResult write would drop or change earlier outcomes: <path>` unless the
  outcomes already in the file are the first outcomes of the envelope.
- `CallResult.ts:callRequestFingerprint`: throws
  `CallResult request is malformed at <path>.`; a key whose value is
  `undefined` does not change the fingerprint.
- `BinaryFile.ts:BinaryFile`: `metadata.name` equals `spec.sha256`. `read`
  throws when the file `<sha256>.<extension>` beside the envelope is missing
  (`BinaryFile envelope has no file: <path>`), does not hash to its name
  (`BinaryFile does not hash to its name: <path>`), or has a different byte
  count. `write` throws, and writes nothing, when the bytes do not hash to
  the name, when the byte count differs, and when a file of that name holds
  different bytes (`BinaryFile name is taken by different bytes: ...`).
- `InitialAgencyRoots.ts:schema`: `metadata.name` is the literal `initial`;
  `spec.agencySourceNames` has at least one entry and no duplicates.
- `RecordsRequest.ts:RecordsRequest`: `metadata.name` matches
  `/^[a-z][a-z0-9]{23}$/` and `metadata.namespace` matches
  `src/shared/source-namespace.ts:sourceNamespacePattern`. Its enums:
  - `spec.submission`: `reserved`, `submitted`, `uncertain`, or `failed`.
  - `spec.transport`: `email` or `portal`.
  - `spec.fulfillment`: `pending` or `fulfilled`.
  - `spec.disposition`: `pending`, `records`, `denied`, or `no_records`.
  - `disposition` of each `spec.responses` entry: `acknowledgment`,
    `partial`, `final`, `denied`, `no_records`, or `unclear`.
- `PropertyCorrection.ts:schema`: `spec.entries` has exactly one entry
  without `inputFingerprint` (the active correction). An entry carries either
  a non-null `value` or `operation: "unset"`; a null `value` is rejected with
  "Use an explicit unset operation to clear a value".
- `PropertyCorrection.ts:PropertyCorrection` `read` and `write`: when the
  subject kind is `Agency` and the target property is `location_path_id`,
  every entry's value must pass
  `src/shared/agency-location-path.ts:requireAgencyPlaceLocationPath`, which
  throws when no lookup is supplied.
- `property-corrections.ts:loadPropertyCorrections` and
  `property-corrections.ts:inspectPropertyCorrection`: `metadata.name` must
  equal `JSON.stringify([kind, name, property])`, else
  `PropertyCorrection identity mismatch`. The loader builds that name from
  the envelope's own subject and target property and also requires the file
  name to match. `inspectPropertyCorrection` builds it from its arguments and
  also requires `spec.subject.kind`, `spec.subject.name`, and
  `spec.targetProperty` to equal them. The loader validates every entry
  value against the target property's schema.
- `property-corrections.ts:setPropertyCorrection`:
  - Throws
    `Cache already has a value. Use --force to overwrite. Current cache:`
    followed by the existing `spec` as JSON when a correction already exists
    and `force` is false.
  - Throws `Use cache unset to clear a value.` for a null value without
    `operation: "unset"`.
  - A supplied `message` must be at least 10 characters after trimming.
  - The value must parse against the target property's schema.
- `property-corrections.ts:correctionPropertySchema` throws
  `Unknown property <kind>.<property>.` when the generated `<kind>Spec` has no
  such property.
- `SourceScopedResolvedProperty.ts:SourceScopedResolvedProperty` `read`:
  `metadata.name` must equal the subject's `apiVersion`, `namespace`, `kind`,
  `name`, the target property, and the input fingerprint joined by `:`, else
  "Wrong source-scoped cache identity".
- `Artifacts.ts:Artifacts` `read`: a referenced artifact file is read with
  the ref's `kind` and `sha256` and the Artifacts envelope's namespace as the
  expected values. An inline record that carries `ref` is rejected, and an
  inline record's `spec` must validate against that kind's record spec (a
  strict partial of it when `metadata.action` is `PATCH`).
- `Artifacts.ts:Artifacts` `write`: an inline artifact item is written in
  files of at most 10,000 records; only the first file carries the item's
  non-`records` spec fields. An item with no records still writes one file.
  A file's `metadata.name` is the Artifacts `metadata.name` when the item
  has one file and `<name>-<index>` (from 0) when it has several, so the
  files are `<name>.<Kind>.yaml` or `<name>-<index>.<Kind>.yaml`.
- `Artifacts.ts:Artifacts` `integrityDigest` throws when a record ref's kind
  has no IO in `./artifact-modules.ts:RECORD_ENVELOPES` or when a record's `metadata.name`
  differs from its key.
- `import-types.ts:importArtifactKindOrder` throws
  `Import type dependency cycle includes <kind>.` on a cycle in `dependsOn`.
  The module calls it when it loads, so a cycle fails the import of
  `import-types.ts`.
- `import-types.ts:parseMutationKind` throws
  `Unsupported DatabaseMutation kind: <kind>` when the kind does not end in
  `Create`, `Read`, or `Update`, and when the kind is exactly one of those
  suffixes.
- `initial-agency-roots.ts:initialAgencyRootsDirectory`,
  `property-corrections.ts:loadPropertyCorrections` (when `root` is defined),
  `property-corrections.ts:inspectPropertyCorrection`, and
  `property-corrections.ts:setPropertyCorrection` reject a namespace that
  fails `src/shared/source-namespace.ts:assertValidSourceId`. The three
  `property-corrections.ts` functions do so through the module's `directory`
  function, which is not exported.
- `excluded-records.ts:loadExcludedRecords`: each entry needs a non-empty
  `kind`, `key`, and `reason`, and `when`, if present, must be a non-empty
  JSON object. A missing file yields an empty map. A later entry with the
  same kind and key replaces the earlier one in the map. It throws:
  - `<path>: expected an exclusion mapping.` when the document is not a
    mapping.
  - `<path>: excluded must be a list.` when `excluded` is present and is not a
    list.
  - `<path> is malformed: <parser error message>` on a YAML parse error.
  - `<path>: excluded[<i>] must be an object with kind, key, and reason.`
    when an entry is not an object.
  - `<path>: excluded[<i>] requires a non-empty <field>.` when `kind`, `key`,
    or `reason` is missing or blank.
  - `Exclusion when must be a nonempty JSON object of source field values.`
    for an invalid `when`.
- `excluded-records.ts:appendExcludedRecord` throws:
  - `Exclusion <field> must not be blank.` for a blank `kind`, `key`, or
    `reason`.
  - `<path>: another exclusion write is in progress.` when
    `<stateDir>/excluded.yaml.tmp` exists.
  - `Already excluded <kind> <key>: <existing reason>` when the entry exists
    and `replace` is not set.
  - `Cannot replace <kind> <key>: not excluded.` when `replace` is set and no
    entry exists.
  - `<path>: expected an exclusion mapping.` when the document is not a
    mapping, and `<path>: excluded must be a list.` when `excluded` is not a
    list.
  - Every error that `loadExcludedRecords` throws for the existing file, and
    the `when` error for the new record.
- `SourceScopedResolvedProperty.ts:SourceScopedResolvedProperty` `read`:
  `metadata.namespace` must be the literal `intake`, `spec.inputFingerprint`
  must be 64 lower-case hex characters, and `spec.subject.apiVersion` must
  equal `intake-api-version.ts:INTAKE_API_VERSION`.
- `import-operations.ts` and `intake-api-version.ts` import nothing, so the
  generator and the generated modules can import them without a cycle (stated
  in each file's header comment).

## Side Effects

- `Command.ts:Command`, `IdentityRestoration.ts:IdentityRestoration`,
  `InitialAgencyRoots.ts:InitialAgencyRoots`, and
  `PropertyCorrection.ts:PropertyCorrection`: `read` reads one file; `write`
  creates the directory and writes
  `<directory>/<encodeURIComponent(metadata.name)>.<Kind>.yaml`.
- `CallResult.ts:CallResult`: `read` reads one file; `write` reads the file
  it is about to replace, when there is one, then writes
  `<directory>/<metadata.name>.CallResult.yaml`.
- `BinaryFile.ts:BinaryFile`: `read` reads the envelope and the file beside
  it. `write` creates the directory, writes the file as
  `<sha256>.<extension>.tmp` and renames it, then writes the envelope as
  `<sha256>.BinaryFile.yaml.tmp` and renames it. A file or an envelope that
  is already there is left as it is.
- `RecordsRequest.ts:RecordsRequest` `write` writes
  `<target>.<process.pid>.tmp` and renames it onto
  `<directory>/<name>.RecordsRequest.yaml`.
- `Artifacts.ts:Artifacts`:
  - `read` reads the Artifacts file. Unless `raw: true`, it also reads each
    referenced artifact file twice (once resolved, once raw to build
    `recordSources`) and every record file those artifacts reference. With
    `includeKinds` it reads only the artifacts of those kinds.
  - `write` writes one file for each group of at most 10,000 records of each
    inline artifact item into `directory`, then the Artifacts file.
  - `integrityDigest` and `digest` read files only.
- `initial-agency-roots.ts:loadInitialAgencyRoots` stats and reads
  `<root>/intake/state/namespaces/<namespace>/InitialAgencyRoots/initial.InitialAgencyRoots.yaml`.
- `property-corrections.ts:loadPropertyCorrections` lists and reads
  `<root>/state/intake/namespaces/<namespace>/PropertyCorrection/*.PropertyCorrection.yaml`.
  The load does not call `log`. The function it returns calls the supplied
  `log` each time it runs, once for each correction of that record that it
  applies or whose `from` does not match.
- `property-corrections.ts:setPropertyCorrection` reads and overwrites one
  file in that folder; earlier active entries are kept with an
  `inputFingerprint` of `previous-override-<n>`, and the new entry is stamped
  with the current time.
- `excluded-records.ts:loadExcludedRecords` reads `<stateDir>/excluded.yaml`.
- `excluded-records.ts:appendExcludedRecord` creates
  `<stateDir>/excluded.yaml.tmp` exclusively with mode `0o600` (a second
  concurrent write fails), reads `excluded.yaml` when it exists, writes the
  updated document, sets the temporary file's mode to that of the existing
  `excluded.yaml` (or `0o666 & ~umask` when there is none), and renames it
  onto `excluded.yaml`. It deletes the temporary file when the write fails.
- `SourceScopedResolvedProperty.ts:SourceScopedResolvedProperty` `read` reads
  one file.
- `import-types.ts` runs `importArtifactKindOrder()` when the module loads
  to build the order used by `compareImportArtifactKinds`.
- `import-type-metadata.ts`, `import-operations.ts`, `intake-api-version.ts`,
  `resource.ts`: None.

## Generated Artifact IO

### The generated files

Each generated file in this folder is written by `scripts/generate-envelope-types.ts` and starts with
`// Generated by scripts/generate-envelope-types.ts. Do not edit.` Do not
edit these files: change the generator and run
`npm run generate:envelope-types`. On every run the generator deletes and
rewrites the files that start with that line, and throws rather than overwrite
a file that does not.
`test/generated-files.integration.test.ts` compares every generated file with
the generator output.

The generator requires `DATABASE_URL` and introspects the migrated database
schema, so the entity specs follow the schema.
`scripts/lib/entity-spec-generator.ts:generateEntitySpecsModule` renders
`entity-specs.ts` from the result of
`scripts/lib/schema-introspection.ts:introspectSchema`. The templates of
the other files are string literals inside
`scripts/generate-envelope-types.ts`. The script resolves its output paths
from the current working directory. The same run also rewrites
the generated files in `src/cli/import/artifacts/io`.

The generated files are:

- `entity-specs.ts`: one zod spec per entity plus per-kind tables derived
  from the database schema.
- One file per plural artifact kind (29 files), all following one pattern.
- `artifact-modules.ts`: a lookup of the per-kind modules keyed by kind,
  and a lookup of the singular record IO objects.

The 29 artifact kinds are `Agencies`, `AgencyArrestProfiles`,
`AgencyPersonnel`, `AgencyPhoneNumbers`, `ArrestProfiles`,
`AuthorityLicenses`, `CivilCaseLinks`, `CivilCasePersonnel`, `CivilCases`,
`CoverageHomepagePlacements`, `CoverageHomepageWindows`,
`CoverageLinkAgencyPersonnel`, `CoverageLinks`, `DataAnnotations`,
`DisciplineAgencyPersonnel`, `Disciplines`, `FederalAgencies`,
`LicenseActions`, `Licenses`, `LicensingAuthorities`, `LocationPathAliases`,
`LocationPathGeometries`, `LocationPaths`, `Personnel`,
`PersonnelEducations`, `PersonnelPhotos`, `ReviewLinks`, `ReviewPersonnel`,
and `Reviews`.

### Generated interface

Per-kind pattern, shown for `Agencies.ts`; every per-kind file exports the
same names with its own kind and entity substituted:

- `Agencies.ts:AgencySpec` re-exports the entity spec from
  `entity-specs.ts`.
- `Agencies.ts:schema` is the zod schema of the plural envelope:
  `apiVersion`, `kind`, `metadata`, and a `spec` with optional `warnings`,
  optional `audit`, and `records` keyed by record key. A `records` entry is
  either an inline `{ metadata?, spec }` or a
  `{ ref: { path, kind: "Agency", sha256? } }`, with `sha256` as 64
  lower-case hex characters. In a kind without a singular record envelope
  the entry is inline only.
- `Agencies.ts:AgenciesEnvelope`, `Agencies.ts:AgenciesInput` (the envelope
  without `apiVersion` and `kind`), and
  `Agencies.ts:AgenciesResolvedEnvelope` (every record resolved to
  `{ metadata, spec }`).
- `Agencies.ts:RecordMetadata` is a record's optional metadata: `action`
  (`PUT`, `PATCH`, or `POST`), `name`, and `selector`.
- `Agencies.ts:ImportArtifactWriteOptions` is
  `{ externalizeRecords, recordsDirectory }`.
- `Agencies.ts:Agencies` is the IO object `{ kind, schema, new, read,
write }`. `read(filePath, options)` accepts `expectedKind`,
  `expectedSha256`, `expectedNamespace`, and `raw`. Its options type also
  accepts `relativeTo`, which the plural read never uses: it resolves record
  refs against the artifact file path.
  `write(directory, envelope, options)` returns `{ path, sha256 }`.
- `Agencies.ts:read` and `Agencies.ts:write` are aliases of the plural read
  and write.

Eleven kinds also have a singular record envelope (`Agencies`,
`AgencyPersonnel`, `AuthorityLicenses`, `DataAnnotations`, `LicenseActions`,
`Licenses`, `LicensingAuthorities`, `LocationPathAliases`,
`LocationPathGeometries`, `LocationPaths`, `Personnel`; the set is
`scripts/generate-envelope-types.ts:RECORD_ENVELOPE_KINDS`). Their files add:

- `Agencies.ts:recordSchema`, the zod schema of the singular envelope.
- `Agencies.ts:AgencyEnvelope` and `Agencies.ts:AgencyInput`.
- `Agencies.ts:Agency`, the IO object for the singular envelope;
  `read(pathOrRef, options)` accepts a path, a `{ path, kind, sha256 }` ref,
  or the wrapped form `{ ref: { path, kind, sha256 } }`; `options` are
  `expectedNamespace` and `relativeTo`.
- Where the singular name would equal the plural kind, the singular is named
  `<Kind>Record`: `Personnel.ts:PersonnelRecord` and
  `AgencyPersonnel.ts:AgencyPersonnelRecord`.

The other eighteen kinds (for example `ReviewLinks.ts:ReviewLinks`) export
the plural names only.

Other files:

- `Artifacts.ts:schema` (hand-written, not exported by name; it is
  `Artifacts.schema`): kind `Artifacts`, whose `spec` has optional
  `personnelSourceNames` and an `artifacts` array of
  `{ ref: { path, kind, sha256 } }` or inline `{ kind, spec }` items.
  `ref.kind` and the inline `kind` must be one of `IMPORT_ARTIFACT_KINDS`,
  `ref.sha256` is optional and must be 64 lower-case hex characters, and an
  inline item's `spec` is validated against the `spec` of that kind's plural
  `schema`.
- `artifact-modules.ts:ARTIFACT_MODULES` maps each plural kind to
  `{ envelope, recordSpec, read, write }` from that kind's file.
- `artifact-modules.ts:RECORD_ENVELOPES` maps each singular record
  kind to its IO object.
- `entity-specs.ts:AgencySpec` and `entity-specs.ts:AgencyCreateSpec`: the
  spec of a record and the spec of its create mutation, repeated for each of
  the 29 entities.
- `entity-specs.ts:importTypeMetadata` gives each plural kind its `kind`,
  `recordKind`, `entityName`, `targetTable`, and `dependsOn`;
  `entity-specs.ts:IMPORT_ARTIFACT_KINDS`,
  `entity-specs.ts:ImportArtifactKind`, and
  `entity-specs.ts:ImportEntityName` are derived from it.
- `entity-specs.ts:TABLE_BY_KIND`, `entity-specs.ts:PRIMARY_KEY_BY_KIND`,
  and `entity-specs.ts:SupportedTableName`: the table and primary-key column
  of each record kind.
- `entity-specs.ts:RECORD_KINDS_IN_DEPENDENCY_ORDER`,
  `entity-specs.ts:FK_REFERENCES`, and `entity-specs.ts:SELF_REFERENCES`:
  record kinds in foreign-key order and each kind's foreign keys.
- `entity-specs.ts:BUSINESS_KEYS` and `entity-specs.ts:RESOLVED_PROPERTIES`:
  per-kind unique-constraint columns and resolved property names.
- `entity-specs.ts:JSON_PROPERTIES`,
  `entity-specs.ts:JSON_REQUIRED_PROPERTIES`,
  `entity-specs.ts:DATE_PROPERTIES`, and
  `entity-specs.ts:TIMESTAMP_PROPERTIES`: per-kind field names by column
  type.
- `entity-specs.ts:GENERATED_MIGRATION_VERSIONS` and
  `entity-specs.ts:GENERATED_MIGRATION_FINGERPRINT`: the migrations the specs
  were generated against.

### Generated invariants

- `Agencies.ts:schema` (and each per-kind `schema`) and `Artifacts.ts:schema`
  require `apiVersion` to equal `INTAKE_API_VERSION` and `kind` to equal the
  file's kind as zod literals, and are `.strict()` on the envelope,
  `metadata`, `spec`, and each record, so unknown keys are rejected.
  `metadata.name` and `metadata.namespace` are required non-empty strings.
- `Agencies.ts:Agencies`: `new`, `read`, and `write` all validate, and throw
  `Agencies is malformed at <path>.` on failure. Unless `raw: true`, `read`
  also throws `Agencies record <key> is malformed at <path>: <file>` when a
  resolved record's spec fails validation.
- `Artifacts.ts:Artifacts`: `new`, `read`, and `write` all validate, and
  throw one line for each issue:
  `Artifacts is malformed at <path>. <message> Received: <json>.`
- `Agencies.ts:schema`: a record's `spec` must match the full
  `entity-specs.ts:AgencySpec`, or a strict partial of it when the record's
  `metadata.action` is `PATCH`.
- `Agencies.ts:read` throws on a sha256 mismatch when `expectedSha256` is
  given, and on a kind or namespace mismatch when `expectedKind` or
  `expectedNamespace` is given. A record read through a `ref` must be in the
  artifact's namespace and its `metadata.name` must equal its record key.
- `Agencies.ts:Agency` `read` and `Artifacts.ts:Artifacts` `read` throw when
  a ref's `kind` or `sha256` is set and does not match the file. A plain
  string path and an absolute ref path are used as given. A relative ref
  path:
  - Needs `relativeTo`, else `Relative <kind> ref requires relativeTo.`
  - Must not leave the directory of the `relativeTo` file, else
    `<kind> ref.path escapes its directory: <path>`.
- `ReviewLinks.ts:write` throws
  `ReviewLinks does not support externalized singular record envelopes.` when
  `externalizeRecords` is true; a kind without a singular record envelope
  accepts inline records only.
- `entity-specs.ts:LocationPathSpec` requires `parent_location_path_id` to be
  null when `level` is `state` and present otherwise.
- `test/generated-files.integration.test.ts` regenerates the generated files
  from the migrated schema and fails when one differs, is missing, or is an
  extra file that starts with the generated header line. It compares the text after Prettier formats both
  sides, so a formatting-only difference does not fail.

### Generated side effects

- `Agencies.ts:read` reads one YAML file and, unless `raw: true`, every
  record file it references.
- `Agencies.ts:write` creates the directory and writes
  `<directory>/<encodeURIComponent(metadata.name)>.Agencies.yaml`; with
  `externalizeRecords: true` it also writes one file per inline record and
  stores a `ref` with `sha256` to each. The record files go in the folder
  `<encodeURIComponent(metadata.name)>.Agencies.records/` (the artifact file
  name without `.yaml`) in the artifact file's directory, or in
  `recordsDirectory`, which is resolved against that same directory.
- `Agencies.ts:Agency` `read` and `write` read and write one singular
  envelope file.
- `artifact-modules.ts`, `entity-specs.ts`: None.
- `scripts/generate-envelope-types.ts` (outside this directory) deletes and
  rewrites the generated files here and in `src/cli/import/artifacts/io`.

## Verification

- Run: `npx vitest run test/shared/io`
- `PropertyCorrection` loading and writing:
  `npx vitest run test/cli/property-corrections.test.ts`
- Generated files match the generator (starts a Postgres database):
  `npx vitest run test/generated-files.integration.test.ts`
