# artifacts

## Overview

The import step that compares a source's `Artifacts` envelope with the
database and writes the difference as a `DatabaseMutations` envelope.

`index.ts` exports `runImportArtifactsCommand`. It is not a CLI command of its
own: `src/cli/data/source-pipeline.ts:generateOneSource` calls it for
`data generate <source>` with `dryImport: true`.

`config.ts:importArtifacts` runs four stages in order: `readArtifactsStage`,
`rejectExistingImportStage`, `validateArtifactRecordsStage` and
`writeDatabaseMutationsStage`. `data-context.ts:DataContext` holds one entity
facade per source record, resolves IDs, slugs and annotations, and emits the
ordered mutations. `resolver-kit.ts` holds the resolver building blocks the
facades use. The remaining files cover agency coordinates and
`location_path` lookup, the agency graph selection, current-row reads, the
slug allocator, and text helpers.

## Interface

- `index.ts:runImportArtifactsCommand` - `(artifactsRef, dependencies?)`
  returns a `CommandResult` with `databaseMutationsPath`. Options:
  `importArtifacts`, `env`, `terminal`, `dryImport`, `useInitialAgencyRoots`,
  `excludedRecords`, `keepCachedCallResults`, `args`, `now`,
  `createCommandName`. `env` defaults to `process.env`. The result also has
  `serviceSkips`: one line for each service that went down during the import,
  which are also the last lines of `stdout`.
- `config.ts:importArtifacts` - `(commandInput)` returns
  `ImportArtifactsResult`:
  `{ ok: true, counts, databaseMutationsPath, serviceSkips }` or
  `{ ok: false, error }`.
- `config.ts:ImportArtifactsCommandInput` - `artifactsPath`, `env`,
  `dryImport`, `useInitialAgencyRoots`, `logger`, `resolveAgencyCoordinates`,
  `excludedRecords`, `commandDirectory`, `commandName`, `clientFactory`,
  `keepCachedCallResults`, `serviceClients`. Without `serviceClients` the
  import builds them with `buildServiceClients` for the `Artifacts`
  namespace and its own command name.
- `data-context.ts:DataContext` - class; `facadeFromSource(kind, input)`,
  `selectAgencyGraph`, `toMutations`, `toDatabaseMutationItems`,
  `toDatabaseMutations(metadata)`, `resolveAddress`, `getCachedLocation`,
  `cacheLocation`, `databaseClient`; members `locations`, `locationPaths`,
  `logger`.
- `data-context.ts:DataContextOptions`,
  `data-context.ts:DatabaseMutationsMetadataInput` - option and metadata
  types.
- `resolver-kit.ts:Resolver` - class
  `Resolver(resolveFn, policy?, cacheInputFn?, validateFn?)` with `resolve`,
  `cacheInput` and `validate`, and the getter `cachesByInput`.
- `resolver-kit.ts:ResolverContext`, `resolver-kit.ts:FacadeSource`,
  `resolver-kit.ts:PropertyCache` - the context a resolver receives, the
  source identity of a record, and the property cache adapter. With the
  context's `report(finding)` a resolver reports a problem with the record;
  with `keepFindings()` it leaves the findings the record's resolvers
  reported on earlier runs as they are, for a run in which it could not
  decide (ADR 0040).
- `resolver-kit.ts:PropertyResolutionFacade`,
  `resolver-kit.ts:ForeignKeyIdSource` - the facade interfaces a resolver
  reads through.
- `resolver-kit.ts:CanonicalIdBackend`, `resolver-kit.ts:BusinessKeyIdBackend`,
  `resolver-kit.ts:ForeignKeyBackend`, `resolver-kit.ts:SelectorBackend` -
  backend adapter types.
- `resolver-kit.ts:resolveReference`, `resolver-kit.ts:referenceResolver`,
  `resolver-kit.ts:facadeForeignKeyResolver`,
  `resolver-kit.ts:facadeNullableForeignKeyResolver`,
  `resolver-kit.ts:facadeLedgerForeignKeyResolver`,
  `resolver-kit.ts:facadeStateLocationPathResolver` - reference and foreign
  key resolution; the first link that resolves wins.
- `resolver-kit.ts:facadeCanonicalIdResolver`,
  `resolver-kit.ts:facadeBusinessKeyIdResolver`,
  `resolver-kit.ts:facadeSelectorOrIdResolver`,
  `resolver-kit.ts:facadeComposedIdResolver` - identity resolvers.
- `resolver-kit.ts:composedResolver` - builds a resolver from other
  properties of the facade.
- `resolver-kit.ts:valueAsString` - `(value)` returns a non-blank string, or
  `undefined`.
- `resolver-kit.ts:titleCaseResolver`, `resolver-kit.ts:nameCaseResolver`,
  `resolver-kit.ts:agencyNameResolver`,
  `resolver-kit.ts:textWhitespaceResolver` - text resolvers for a required
  column.
- `resolver-kit.ts:titleCaseResolverNullable`,
  `resolver-kit.ts:nameCaseResolverNullable`,
  `resolver-kit.ts:nameSuffixResolverNullable`,
  `resolver-kit.ts:lowerCaseEmailResolverNullable` - text resolvers for a
  nullable column. `agencyNameResolver` and `textWhitespaceResolver` have no
  nullable variant; the suffix and email resolvers have no required variant.
- `agency-coordinate-resolver.ts:createCensusAgencyCoordinateResolver` -
  `(fetchFn = fetch, options?)` returns a function from
  `AgencyCoordinateRequest[]` to `AgencyCoordinateResolution[]`.
- `agency-coordinate-types.ts:AgencyCoordinateRequest`,
  `agency-coordinate-types.ts:AgencyCoordinateResolution` - the request and
  result types of that function.
- `agency-address-resolution.ts:resolveImportAddress` - `(input, options)`
  returns an `AddressResolution` or `undefined`. `options` is an
  `agency-address-resolution.ts:AgencyAddressResolutionOptions`.
- `location-resolution.ts:LocationDataContext` - `resolveCoordinates(input)`,
  `resolveAddress(input)`.
- `location-resolution.ts:LocationPathDataContext` - `getByPath`, `getById`,
  `getPlaceContainingPoint`.
- `location-resolution.ts:AddressResolutionRequest`,
  `location-resolution.ts:AddressResolution`,
  `location-resolution.ts:LocationResolution`,
  `location-resolution.ts:ResolveAddressInput` - the address request, the
  coordinates, the resolved location and the input type.
- `agency-graph.ts:selectAgencyGraph` -
  `(existing, incoming, additionalAgencyRootIds?, explicitPersonnelIds?)`
  returns the set of selected graph keys.
- `agency-graph.ts:AGENCY_GRAPH_EDGES`, `agency-graph.ts:AGENCY_GRAPH_ROOT`,
  `agency-graph.ts:AGENCY_CASE_ROOT`, `agency-graph.ts:AGENCY_GRAPH_COLUMNS`,
  `agency-graph.ts:overlayAgencyGraph`, `agency-graph.ts:graphKey` - the graph
  constants and helpers.
- `agency-graph.ts:InclusionEdge`, `agency-graph.ts:AgencyGraphRecord` - the
  edge type and the record type of the graph.
- `artifacts-reader.ts:readImportArtifacts` -
  `(artifactsPath, { includeKinds? })` returns
  `{ artifacts, artifactMutation }`.
- `artifact-mutation.ts:applyOptionalArtifactMutation` - applies the
  `ArtifactMutations` file beside the `Artifacts` file to the envelope in
  memory. Returns an `artifact-mutation.ts:ApplyArtifactMutationResult`:
  `{ applied: false }` when the file is absent, otherwise
  `{ applied: true, reference }` with an
  `artifact-mutation.ts:ArtifactMutationReference` (`{ path, digest }`).
- `existing-import.ts:assertNoExistingImport` - `(artifacts, { env? })`.
- `validate-artifact-records.ts:validateArtifactRecords` - `(artifacts)`.
- `assert-schema-current.ts:assertGeneratedSchemaCurrent` -
  `(appliedMigrations)`.
- `mutation-plan.ts:planDatabaseMutationItems` - `(envelopes)` drops the
  updates for which `isCheckOnlyUpdateItem` is true, then orders the rest:
  creates before updates, by `RECORD_KINDS_IN_DEPENDENCY_ORDER`, then by name.
  The creates of a kind listed in `SELF_REFERENCES` are then re-ordered so a
  parent comes before its children.
- `mutation-plan.ts:isCheckOnlyUpdateItem` - `(item)` is true for an update
  whose operations are all `check`.
- `current-row-reader.ts:CurrentRowReader` - `getById`, `getByColumns`,
  `getRowsByColumns`.
- `batch-loader.ts:BatchLoader` - `load(input)`; gathers pending loads into
  one `batchLoad` call.
- `slug.ts:SlugAllocator` - `register(kind, slug, canonicalId)`,
  `ensureUnique(kind, { base, canonicalId })`.
- `property-resolution-error.ts:CacheCorrectionError`,
  `property-resolution-error.ts:UnresolvedPropertiesError`,
  `property-resolution-error.ts:CensusGeocoderRequestError` - error classes.
- `case-normalization.ts:titleCase`, `case-normalization.ts:nameCase`,
  `case-normalization.ts:nameSuffix`, `case-normalization.ts:lowerCaseEmail`,
  `case-normalization.ts:expandAgencyAbbreviations` - text helpers.
- `name-similarity.ts:normalizeName`, `name-similarity.ts:nameSimilarity`,
  `name-similarity.ts:officerNameConfidence` - name matching helpers.
  `officerNameConfidence` returns a `name-similarity.ts:NameMatch`:
  `{ confidence, uncertainty }`.
- [facades](./facades/README.md) - `EntityFacade` and the per-kind resolver
  registry.
- [io](./io/README.md) - canonical IO for the mutation envelope kinds.

## Invariants

- `config.ts:importArtifacts` - returns `{ ok: false }` when `commandName` is
  blank; any thrown error becomes `{ ok: false, error }`.
- `config.ts:readArtifactsStage` - calls `requireTransformCompletion` before
  it reads records.
- `config.ts:writeDatabaseMutationsStage` - throws:
  - `Command directory is required to write DatabaseMutations.` when no
    `commandDirectory` was given;
  - when `DATABASE_URL` is blank;
  - when the connection or `select 1` fails;
  - when `assertGeneratedSchemaCurrent` fails;
  - the error of a `replayDatabaseMutations` result that is not `ok`.
- `config.ts:appendStreamingLocationPathGeometryMutations` - throws
  `DATABASE_URL is required to plan location path geometry mutations.`
- `config.ts:requiredStreamingString` - throws
  `Artifacts location path geometry <key> is missing required field <field>.`
  for a blank or non-string value; used for `sourceLocationPathKey`.
- `config.ts:canonicalLocationPathIdForGeometry` - throws when a geometry
  maps to no canonical ID; it never mints one.
- `config.ts:readLocationPathGeometryRecords` - throws when a referenced
  `LocationPathGeometry` record's `metadata.name` differs from its record key.
- `data-context.ts:validateSourceRecordContext` - throws on an `apiVersion`
  other than `INTAKE_API_VERSION` and on a missing `namespace` or `name`.
- `data-context.ts:DataContext.visitMutations` - throws `Duplicate <kind>`
  when two facades with different identities share the same non-null
  `BUSINESS_KEYS` values, and when one URL has two owners.
- `data-context.ts:DataContext.toDatabaseMutationItems` - drops mutations
  for which `isCheckOnlyUpdateItem` is true. It then clears every facade, so
  a context emits its mutations once; `toDatabaseMutations` calls it.
- `data-context.ts:DataContext` - the constructor's slug owner lookup throws
  `Canonical slug conflict for <kind>: <slug> belongs to database <id> and cache <id>.`
  when the database and the cache name different owners.
- `data-context.ts:DataContext.databaseClient` - throws
  `Database client is required for database reads.` when no client was
  supplied.
- `resolver-kit.ts:Resolver` - the constructor throws
  `A resolver is constructed with at most one of defaultValue or exception.`
- `resolver-kit.ts:Resolver.resolve` - an undefined value throws the policy
  exception, or returns the policy default, or throws `Error(locate())`.
- `resolver-kit.ts:resolveReference` - throws
  `Cannot resolve <kind> reference` when no link resolves.
- `resolver-kit.ts:referenceResolver` - throws when a required source value
  is missing, and when no link resolves the reference
  (`<kind> <namespace>/<name> references <targetKind> <reference>, which does not exist in namespace <namespace>.`).
- `resolver-kit.ts:facadeSelectorOrIdResolver` - for `PATCH` with a selector,
  throws when the mapped canonical ID differs from the selected row; that
  check runs only when the record's raw `source_namespace` is not null. It
  throws
  `<kind> <action> by <selector|name> is not yet implemented; use PATCH with a selector.`
  for `POST`, and for `PATCH` without a selector.
- `resolver-kit.ts:facadeBusinessKeyIdResolver` - throws when a business-key
  column resolves to no value.
- `resolver-kit.ts:facadeComposedIdResolver` - throws
  `Cannot compose id: <property> resolved to no value.`
- `agency-coordinate-resolver.ts:requestCensus` - throws
  `CensusGeocoderRequestError` on a non-OK status, a timeout or a fetch
  failure.
- `agency-coordinate-resolver.ts:BATCH_SIZE`,
  `agency-coordinate-resolver.ts:DEFAULT_REQUEST_TIMEOUT_MS` - a batch
  request holds at most 1000 addresses; a request times out after 30 000 ms
  unless `options.requestTimeoutMs` is given. Requests use benchmark
  `Public_AR_Current`; the single-address request also uses vintage
  `Current_Current`. Neither constant is exported.
- `agency-address-resolution.ts:resolveImportAddress` - throws
  `UnresolvedPropertiesError` for `latitude` and `longitude` when the geocoder
  returns no finite coordinates. It returns `undefined` when
  `options.resolveAgencyCoordinates` is absent, and returns the input
  coordinates without a geocode when both are finite.
- `location-resolution.ts:addressResolutionRequest` - throws
  `Cannot resolve address for <entityType> <entityId> without <fields>.` when
  `entityType`, `entityId`, `state`, `place`, `zipCode` or `address` is blank.
  Not exported.
- `location-resolution.ts:LocationDataContext.resolveCoordinates` - throws
  `Cannot resolve address for <entityType> <entityId>.` when the geocoder
  returns nothing.
- `location-resolution.ts:LocationPathDataContext.getPlaceContainingPoint` -
  throws when no place boundary contains the point.
- `location-resolution.ts:LocationPathDataContext.uniqueContainingLocationPath` -
  throws when more than one `location_path` of the winning resolution class
  contains the point, and
  `Missing location resolution class for <subject>` when no match has a
  resolution class of `primary`, `county_subdivision` or `consolidated_city`.
- `agency-graph.ts:selectAgencyGraph` - throws when a selected record has a
  foreign key to a known but unselected record.
- `artifact-mutation.ts:applyOptionalArtifactMutation` - throws unless the
  mutation file's `metadata.namespace` is `manual`, its `metadata.name` equals
  the `Artifacts` name, and every target names that `Artifacts` namespace and
  command. It also throws:
  - `Artifact mutation path is not a file: <path>`;
  - `Artifact mutation references missing <entity> source name <name>.` when
    the target record is absent;
  - `Artifact mutation references malformed <entity> source name <name>.`
    when the target record has no `spec` object.
- `existing-import.ts:assertNoExistingImport` - throws when a
  `DatabaseMutations` file for the same namespace and source `Artifacts` name
  already exists. It returns without a check when
  `INTAKE_WORKSPACE` is not set.
- `existing-import.ts:existingImportCandidate` - throws
  `Cannot check existing DatabaseMutations file because it is invalid: <path>`
  when a candidate file cannot be read. Not exported.
- `validate-artifact-records.ts:validateArtifactRecords` - throws on the first
  record whose `spec` fails its record schema. A record with
  `metadata.action: PATCH` is checked against a strict partial of that
  schema.
- `assert-schema-current.ts:assertGeneratedSchemaCurrent` - throws when the
  applied migrations differ from `GENERATED_MIGRATION_FINGERPRINT`.
- `slug.ts:SlugAllocator.register` - throws `Canonical slug conflict` when a
  slug has a different owner.
- `current-row-reader.ts:CurrentRowReader.requireClient` - throws when no
  database client was supplied.
- `current-row-reader.ts:tableForKind` - throws
  `No table is mapped for record kind <kind>.` Not exported.

## Side Effects

- `index.ts:runImportArtifactsCommand` - creates a command directory and
  writes `<commandDirectory>/<commandName>.log`; reads `LOG_LEVEL`. It first
  reads the `Artifacts` file raw to get the namespace for the command
  directory. It returns exit code 1, before a command directory is created,
  when that read throws, and exit code 1 when `createCommandDirectory`
  throws.
- `config.ts:workspaceRootFromEnv` - reads `INTAKE_WORKSPACE` from `commandInput.env` only; it does not fall back to
  `process.env`. Not exported.
- `config.ts:readArtifactsStage` - reads the same two variables through
  `intakeWorkspace`, from `commandInput.env` or else `process.env`.
- `existing-import.ts:intakeCommandRoot` - reads the same two variables. Not
  exported.
- `config.ts:writeDatabaseMutationsStage` - reads `DATABASE_URL`; opens a
  database client and reads the schema metadata, the agency graph and
  `location_path` rows; reads the property corrections
  (`loadPropertyCorrections`); reads whether the `agency` table is empty
  (`agencyTableIsEmpty`) when `useInitialAgencyRoots` is not given, and the
  initial agency roots (`loadInitialAgencyRoots`); creates the command
  directory and writes the `DatabaseMutations` envelope to it; applies it to
  the database through `replayDatabaseMutations` only when `dryImport` is not
  true.
- `config.ts:appendStreamingLocationPathGeometryMutations` - opens a second
  database client, after the first is closed, for
  `writeLocationPathGeometryMutationRefs`.
- `config.ts:writeLocationPathGeometryMutationRefs` - reads
  `public.location_path_geometry`; writes one `LocationPathGeometryCreate` or
  `LocationPathGeometryUpdate` file per changed geometry under
  `<commandName>.DatabaseMutations.records/`.
- `config.ts:agencyResolutionDeps` - reads and writes `ResolvedProperty`
  envelopes under the workspace root through `readResolvedProperty` and
  `writeResolvedProperty`.
- `data-context.ts:DataContext.findOrCreateCanonicalId` - with a ledger it
  calls `ledger.findOrCreate`, which reads and writes the
  `SourceNameToCanonicalId` ledger. Only when no ledger was supplied does it
  return `resolve()`, or a cuid2 `createId()` when no `resolve` was given.
- `data-context.ts:DataContext.businessKeyId` - with a ledger it calls
  `ledger.findOrCreate("intake", kind, key, resolve)`: the mapping is written
  under the fixed namespace `intake`.
- `data-context.ts:DataContext.visitMutations` - with a database client it
  reads the `DataAnnotation` rows where `producer_namespace = 'intake'`. It
  builds `DataAnnotation` facades in namespace `intake` and emits their
  mutations, including one that sets an earlier active annotation to
  `resolved`. A record whose resolver called `keepFindings()` has none of
  its earlier resolver findings set to `resolved`.
- `data-context.ts:DataContext.resolverBackend` - database reads through
  `CurrentRowReader`. Its `serviceClients()` returns the `serviceClients`
  given in `DataContextOptions`, and throws
  `This import was given no service clients, so a resolver cannot call an outside service.`
  when none was given.
- `agency-coordinate-resolver.ts:resolveBatch` - HTTP POST to
  `https://geocoding.geo.census.gov/geocoder/locations/addressbatch`.
- `agency-coordinate-resolver.ts:resolveSingleAddress` - HTTP GET to
  `https://geocoding.geo.census.gov/geocoder/geographies/address`.
- `location-resolution.ts:LocationPathDataContext.readByPath` - database
  reads of `location_path` and `location_path_alias`.
- `location-resolution.ts:LocationPathDataContext.getById` - database read of
  one `location_path` row.
- `location-resolution.ts:LocationPathDataContext.uniqueContainingLocationPath` -
  database read through `readLocationPathsContainingPoint`.
- `artifacts-reader.ts:readImportArtifacts` - reads the `Artifacts` file and
  the `ArtifactMutations` file beside it.
- `existing-import.ts:findExistingImportPath` - lists
  `<workspace>/command` and each directory in it, one level down, and reads
  each `*.DatabaseMutations.yaml` until the first match. A missing
  `<workspace>/command` means no existing import; any other listing error is
  thrown. Not exported.
- `current-row-reader.ts:CurrentRowReader.readBatch` - database `select`
  across the tables in `TABLE_BY_KIND`.
- `current-row-reader.ts:CurrentRowReader.getByColumns`,
  `current-row-reader.ts:CurrentRowReader.getRowsByColumns` - one database
  read per call; they are not batched.

## Verification

- Run: `npx vitest run test/import`
