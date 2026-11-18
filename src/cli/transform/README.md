# transform

## Overview

The transform step of a source: it runs the source's `transform` function on
the acquired input and writes the result as an `Artifacts` envelope in a new
command directory. It stops before the import.

This directory registers no CLI command. `src/cli/data` calls it for
`data transform`. `source-transform.ts` defines the types a source's
`transform` and `acquire` functions receive. The other files load a source
module, apply the source's excluded records, stream `LocationPathGeometries`
records to disk, order sources by the kinds they produce, and give a
transform access to personnel and agencies in the database.

## Interface

- `index.ts:transformSource` - `(sourceId, paths, options, deps)` returns
  `{ artifactsPath }` or `{ error }`. An error thrown by
  `assertValidSourceId` or `deps.beginCompletion()` rejects the promise
  instead; both run before the `try`.
- `index.ts:buildTransformSourceDeps` - `(sourceId, paths, env, options)`
  returns the `TransformSourceDeps` for `transformSource`. `sourcesRoot` is
  `<process.cwd()>/sources`.
- `index.ts:sourceInputDir` - `(workspace, sourceId)` returns the directory
  of the latest acquisition.
- `index.ts:sourceInputPaths` - `(inputDir)` returns the sorted input files
  at every depth. An entry whose name starts with `.` is skipped. It throws
  `Unsupported source input entry: <path>` on an entry that is neither a file
  nor a directory, and throws the `readdir` error when a directory is missing
  or cannot be read.
- `source-transform.ts:SourceTransform` - `(deps: TransformDeps)` returns a
  `SourceManifest`.
- `source-transform.ts:SourceAcquire` - `(deps: AcquireDeps)`. `AcquireDeps`
  has `clients`, the `ServiceClients` of the acquire command.
- `source-transform.ts:TransformDeps`, `source-transform.ts:AcquireDeps`,
  `source-transform.ts:TransformDataContext`,
  `source-transform.ts:AcquireDataContext`,
  `source-transform.ts:SourceManifest` - the types passed to and returned by
  a source.
- `source-transform.ts:EmittedRecords`, `ResolvedPersonnel`,
  `ResolvedAgencyLocation`, `ResolvedAgency`, `AcquireAgencyRecord`,
  `AcquireAgencyPage`, `AcquireSearchResult` - the types those types are
  built from.
- `source-transform.ts:buildArtifactsEnvelope` -
  `(sourceId, digest, manifest, refItems?)` returns an `ArtifactsEnvelope`
  named `<sourceId>-<digest>`.
- `source-transform.ts:recordOrigin` - `(spec)` returns
  `{ namespace, name }` or `undefined`.
- `load-source-module.ts:loadSourceModule`,
  `load-source-module.ts:loadSourceAcquire`,
  `load-source-module.ts:findSourceAcquire`,
  `load-source-module.ts:loadSourceProduces`,
  `load-source-module.ts:loadSourceStandalone` - `(sourceId, sourcesRoot)`;
  read one part of a source module.
- `load-source-module.ts:assertValidSourceId` - re-exported from
  `src/shared/source-namespace.ts`.
- `emit-sink.ts:createEmitSink` - `(workspaceDir, namespace)` returns an
  `EmitSink` with `emit`, `records` and `flush`.
  - `records()` yields `{ kind, key, spec }` for each emitted record.
  - `flush(keep?)` returns `EmitRefItem[]`: one ref to the
    `LocationPathGeometries` file, or `[]` when no record is kept. A second
    `flush` returns the first result.
- `emit-sink.ts:EmitSink`, `emit-sink.ts:EmitRefItem` - the sink type and
  `{ ref: { path, kind, sha256 } }`.
- `exclude-records.ts:selectActiveExcludedRecords`,
  `exclude-records.ts:cascadeExcludedRecord`,
  `exclude-records.ts:excludeManifestRecords`,
  `exclude-records.ts:filterManifestRecords` - apply excluded records to a
  manifest, including the records that refer to them.
- `exclusion-annotations.ts:attachExclusionEvidence` -
  `(manifest, excluded, namespace)` returns the manifest with
  `source_exclusions` set on the licensing authority record.
- `personnel-resolver.ts:createTransformDataContext` -
  `(client, ledger, namespace)` returns a `TransformDataContext`.
- `source-order.ts:planSourceOrder` - `(sources)` returns
  `{ order, edges, skipped }`.
- `source-order.ts:topologicalOrder`, `source-order.ts:consumesOf` - ordering
  helpers.
- `source-order.ts:SourceProduces`, `OrderEdge`, `SourceOrderPlan` - the
  input, edge and result types of `planSourceOrder`.
- `read-xlsx.ts:readXlsx` - `(filePath, sheet?, requiredColumns?)` returns
  one object per row.
- `assert-required-columns.ts:assertRequiredColumns` -
  `(available, required, context)`.
- `employment.ts:reconstructEmployment` -
  `(events, affiliations, agencyAffiliations?)` returns
  `{ assignments, issues, rows }`. `rows[i]` is the outcome of `events[i]`.
  A `leave` event ends a period on its date. An `end` event that follows it at
  that agency, with no period open and no start between, moves that period's
  end to its own date.
- `employment.ts:EmploymentEventInput`, `EmploymentAffiliation`,
  `EmploymentEpisode`, `EmploymentRowOutcome` - the input and result types of
  `reconstructEmployment`.
- `state.ts:sourceStateDir` - `(env, sourceId)` returns
  `<workspace>/state/<sourceId>` and creates it.
- [parse](./parse/README.md) - readers for shapefiles, GeoJSON and ZIP
  archives.

## Invariants

- `index.ts:transformSource` - exit code 1 when a source that is not
  standalone has no input paths.
- `index.ts:transformSource` - exit code 1 with
  `emitted undeclared kind(s)` when the source emits a kind missing from its
  `produces`.
- `index.ts:sourceInputDir` - throws when the source has no acquired input.
- `index.ts:buildTransformSourceDeps` - `beginCompletion` writes the
  `started` completion record first. It then throws
  `No completed acquisition for transform.` or
  `Transform paths must exactly match the completed acquired snapshot.`
  `transformSource` calls it before the no-paths check.
- `source-transform.ts:recordOrigin` - throws
  `Source namespace and source ID must be supplied together.`
- `load-source-module.ts:loadSourceProduces` - throws
  `Source <id> must declare a produces array` when the source has no
  `produces`. `src/cli/source-discovery.ts:loadIntakeSource` checks the array
  and its kinds when the source is loaded.
- `load-source-module.ts:loadSourceModule` - throws
  `Source <id> does not support transform`.
- `load-source-module.ts:loadSourceAcquire` - throws
  `Source <id> does not support acquire`.
- `emit-sink.ts:createEmitSink` - `emit` throws after `flush`, for a kind
  other than `LocationPathGeometries`, and on a duplicate key.
- `exclusion-annotations.ts:attachExclusionEvidence` - throws when more than
  one licensing authority is mapped for the namespace. For each exclusion it
  throws unless exactly one authority owns it: one that is mapped, or one
  that already carries that exclusion for the namespace. No mapped authority
  and no exclusions does not throw.
- `personnel-resolver.ts:createTransformDataContext` - `resolvePersonnel`
  throws when the agency source ID maps to no canonical agency.
  - `resolvePersonnel` returns `null` when the best name confidence is below
    `NAME_FLOOR` (0.85), and on a tie: a second candidate at or above the
    floor, within `AMBIGUITY_BAND` (0.03) of the best, that the best does not
    beat on uncertainty. Neither constant is exported.
  - `resolveAgency` returns `null` unless exactly one agency matches the
    normalized name, and for a normalized name shorter than 3 characters.
- `source-order.ts:topologicalOrder` - throws
  `Source dependency cycle among ...`.
- `read-xlsx.ts:readXlsx` - throws when the named worksheet is absent, and
  when a column in `requiredColumns` is missing from the header row. It
  returns `[]` when no sheet is named and the workbook has no worksheet.
- `assert-required-columns.ts:assertRequiredColumns` - throws when a required
  column is missing.
- `state.ts:sourceStateDir` - throws for an invalid source ID
  (`assertValidSourceId`), when `INTAKE_WORKSPACE` is not set (`intakeWorkspace`), and when the state directory
  cannot be created.

## Side Effects

- `index.ts:transformSource` - reads `DATABASE_URL` and `INTAKE_WORKSPACE`; connects to the database when `DATABASE_URL` is
  set; runs the source's `transform` function; writes log lines through
  `deps.logger`. It also:
  - reads the source's excluded records from the state directory
    (`deps.loadExcludedRecords`);
  - reads the system clock for the `validationDate` it passes to the source;
  - reads every input file for the digest (`index.ts:digestOfPaths`, not
    exported), which is the first 16 hex characters of a sha256;
  - writes the `SourceNameToCanonicalId` ledger through the data context
    when `DATABASE_URL` is set.
- `index.ts:buildTransformSourceDeps` - creates the source's state directory
  (`sourceStateDir`); imports the source module to read `standalone` and
  `produces`; `makeWorkspace` creates a command directory; `writeEnvelope`
  writes the `Artifacts` file there; `beginCompletion` and `complete` write
  the transform completion record.
- `emit-sink.ts:createEmitSink` - `emit` writes one `LocationPathGeometry`
  file per record under `geometries.LocationPathGeometries.records/` in the
  workspace directory; `flush` writes `geometries.LocationPathGeometries.yaml`
  there, and writes nothing when no record is kept; `records` reads each
  record file back. A record file that `keep` drops stays on disk.
- `personnel-resolver.ts:createTransformDataContext` - `select` on
  `agency_personnel`, `personnel` and `agency`; reads the
  `SourceNameToCanonicalId` ledger and, through `ledger.sourceIdFor`, writes
  a new source ID to it when a resolved record has none.
- `load-source-module.ts:loadSourceModule` - imports the source's
  `intake.source.ts` module.
- `read-xlsx.ts:readXlsx` - reads one `.xlsx` file.
- `state.ts:sourceStateDir` - reads `INTAKE_WORKSPACE` from `env`; creates `<workspace>/state/<sourceId>`.

## Verification

- Run: `npx vitest run test/cli/transform`
