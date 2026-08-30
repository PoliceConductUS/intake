# config-driven-source-import Specification

## Purpose

TBD - created by archiving change redesign-config-driven-intake. Update Purpose after archive.

## Requirements

### Requirement: Config-Driven Source Run Command

The intake CLI MUST provide `intake run <source-id> <path...> [--dry-run]` accepting one
or more file or folder paths. It loads `sources/<source-id>/config.ts`, invokes the
module's `run` with injected dependencies, receives the `Artifacts` manifest `run`
returns, and imports it through the existing artifacts import pipeline. The command MUST
NOT re-implement identity assignment, mutation planning, or database apply; it MUST
delegate those to the existing pipeline.

#### Scenario: Operator runs a configured source against a saved snapshot

- **WHEN** an operator runs `intake run gov.azpost.roster ./Officer-List.xlsx`
- **THEN** intake loads `sources/gov.azpost.roster/config.ts`, invokes its `run`, and
  hands the returned `Artifacts` manifest to the existing import pipeline, which assigns
  canonical ids and applies `DatabaseMutations`

#### Scenario: Multiple paths in one run

- **WHEN** an operator runs `intake run <source-id> file-a.xlsx file-b.xlsx`
- **THEN** intake passes both paths to `run`, and the records `run` returns from all paths
  are imported together

#### Scenario: Dry-run plans without applying

- **WHEN** an operator runs `intake run <source-id> <path> --dry-run`
- **THEN** intake writes the planned `DatabaseMutations` envelope to the run workspace and
  MUST NOT apply database mutations

#### Scenario: Command validates required arguments

- **WHEN** an operator runs `intake run` without a source id, or with a source id but no
  path
- **THEN** intake fails before invoking `run` or writing any database rows

#### Scenario: Unknown source id

- **WHEN** the `<source-id>` has no `sources/<source-id>/config.ts`
- **THEN** intake fails with a clear error before invoking `run` or writing any database
  rows

### Requirement: Source Module Contract

A source's config MUST be a `config.ts` module under `sources/<source-id>/` that exports
a deterministic `run` function. `run` MUST read the CLI-provided paths and **return** an
`Artifacts` manifest describing the records it generated; it MUST NOT emit through an
injected callback, perform the import, assign canonical ids, or write to the database.
`run` MUST be deterministic for its inputs: the same input bytes MUST produce the same
returned manifest, with no dependence on network access, wall-clock time, or randomness.
The runtime MUST fail before running when the module does not export `run`.

#### Scenario: run returns a manifest the runtime imports

- **WHEN** a source's `run` reads its input and returns an `Artifacts` manifest of the
  records it generated
- **THEN** the runtime hands that returned manifest to the existing import pipeline

#### Scenario: Missing run export fails early

- **WHEN** `sources/<source-id>/config.ts` does not export `run`
- **THEN** intake fails before parsing any path or writing any database rows

#### Scenario: run is deterministic

- **WHEN** the same input paths are processed twice
- **THEN** `run` returns the identical manifest both times

### Requirement: Injected Source-Module Dependencies

The runtime MUST supply `run`'s dependencies by dependency injection — narrow,
explicitly-typed parameters wired by the `intake run` command acting as the composition
root, mirroring how `importArtifacts` receives injected adapters such as `logger` and
`clientFactory`. The runtime MUST NOT hand `run` a service-locator or broad context
object, and MUST NOT hand it any intake-owned database, canonical-id, mapping, or mutation
handle. The runtime MUST inject only the capabilities a module uses (for AZ POST, a
deterministic xlsx parse capability). When a module needs per-run evidence/output space or
reusable cache, the runtime MUST inject a per-run workspace path and a persistent state
path consistent with the current `Command` envelope's `path` and `statePath` grants. The
exact injected set is deferred design work; this requirement fixes the injection style,
not the full surface.

#### Scenario: run receives narrow injected dependencies

- **WHEN** the `intake run` command invokes a source module
- **THEN** `run` receives the CLI paths and the narrow capabilities it needs as explicit
  parameters, not a shared context object it reaches through

#### Scenario: Modules are not handed intake-owned state

- **WHEN** the runtime injects dependencies into `run`
- **THEN** `run` receives no direct database client, `SourceNameToCanonicalId` handle, or
  mutation-planning access; those remain owned by the runtime and the existing pipeline

#### Scenario: Injected parse capability is deterministic

- **WHEN** the injected xlsx parse capability reads the same workbook twice
- **THEN** it returns the identical rows both times, from the first sheet keyed by the
  header row

#### Scenario: Unreadable input fails before database writes

- **WHEN** a path passed to an injected parse capability is missing, unreadable, or not
  the expected format
- **THEN** intake fails before reading `SourceNameToCanonicalId` records or writing any
  database rows

### Requirement: Source-Local Identity In The Returned Manifest

Each record in the manifest `run` returns MUST be keyed by its source-local identity. The
runtime MUST preserve those keys when importing and MUST NOT generate canonical database
ids; canonical cuid2 assignment and persistence MUST remain the responsibility of the
existing pipeline's `SourceNameToCanonicalId` state.

#### Scenario: Record key is the source-local identity

- **WHEN** `run` returns a `Personnel` record keyed by `12345` for an officer whose POST
  ID is `12345`
- **THEN** the existing pipeline mints or reuses the canonical cuid2 for that source-local
  key, and the runtime assigns no canonical id itself

#### Scenario: The manifest carries no canonical ids

- **WHEN** `run` returns its `Artifacts` manifest
- **THEN** the manifest contains source-local record keys only and no canonical database
  ids

#### Scenario: Re-running the same snapshot is not a second import

- **WHEN** an operator runs the same source against a snapshot whose `Artifacts` identity
  already imported
- **THEN** the existing-import guard prevents a duplicate import rather than creating
  conflicting rows

### Requirement: Kind-Agnostic, Additive, Envelope-Validated Records

The runtime MUST import exactly the record kinds present in the returned manifest and MUST
NOT assume any particular kind is present. Records absent from a manifest MUST NOT produce
delete mutations. The runtime MUST NOT re-validate which target fields are legal; the
validity of each record MUST be enforced by the target kind's existing envelope schema,
failing loudly on an invalid record.

#### Scenario: Only returned kinds are imported

- **WHEN** a source's `run` returns only `Personnel` records
- **THEN** the import contains only `Personnel` records and no other kinds

#### Scenario: Disappearance does not delete

- **WHEN** a later snapshot's manifest no longer contains a record a prior manifest
  included
- **THEN** the runtime emits no delete mutation for the absent record

#### Scenario: Invalid record is rejected by the envelope

- **WHEN** a returned record omits a field the target kind's spec requires (e.g.
  `last_name`)
- **THEN** the existing envelope validation rejects the record and intake fails loudly
  rather than importing a partial row

### Requirement: Reuse of the Existing Import Pipeline and Change Record

The command MUST produce the durable record of what changed by reusing the existing
`DatabaseMutations` envelope written to the run workspace. This slice MUST NOT introduce a
new durable change-record type and MUST NOT emit any external change event.

#### Scenario: Import produces the existing durable artifacts

- **WHEN** a non-dry-run `intake run` completes successfully
- **THEN** a `DatabaseMutations` envelope is written to the run workspace by the existing
  pipeline and the database mutations are applied

#### Scenario: No new change type or transport is introduced

- **WHEN** `intake run` completes
- **THEN** intake writes no new change-record envelope kind and emits no external event or
  message
