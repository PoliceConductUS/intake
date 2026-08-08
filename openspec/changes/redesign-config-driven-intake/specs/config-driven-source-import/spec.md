## ADDED Requirements

### Requirement: Config-Driven Source Run Command

The intake CLI MUST provide `intake run <source-id> <snapshot-ref> [--dry-run]` that
loads the source's transform config, parses the referenced snapshot into records,
emits a typed `Artifacts` envelope, and imports it through the existing artifacts
import pipeline. The command MUST NOT re-implement identity assignment, mutation
planning, or database apply; it MUST delegate those to the existing pipeline.

#### Scenario: Operator runs a configured source against a saved snapshot

- **WHEN** an operator runs `intake run gov.azpost.roster ./Officer-List.xlsx`
- **THEN** intake loads `sources/gov.azpost.roster/source.yaml`, parses the snapshot,
  builds an `Artifacts` envelope, and hands it to the existing import pipeline, which
  assigns canonical ids and applies `DatabaseMutations`

#### Scenario: Dry-run plans without applying

- **WHEN** an operator runs `intake run <source-id> <snapshot-ref> --dry-run`
- **THEN** intake writes the planned `DatabaseMutations` envelope to the command
  directory and MUST NOT apply database mutations

#### Scenario: Command validates argument count

- **WHEN** an operator runs `intake run` without a source id, without a snapshot ref,
  or with extra positional arguments
- **THEN** intake fails before parsing the snapshot or writing any database rows

#### Scenario: Unknown source id

- **WHEN** the `<source-id>` has no `sources/<source-id>/source.yaml`
- **THEN** intake fails with a clear error before parsing the snapshot or writing any
  database rows

### Requirement: Source Transform Configuration

A source's transform config MUST be a declarative file under `sources/<source-id>/`
that declares the snapshot format and one or more record mappings, each with a target
`kind`, an `identity`, and a field `map`. The runtime MUST validate the config before
parsing the snapshot and MUST reject an unknown target `kind` and any mapped target
field that is not part of that kind's record spec.

#### Scenario: Valid config is loaded

- **WHEN** `intake run` loads a config declaring `kind: Personnel`, an `identity`, and
  a `map` of supported `PersonnelSpec` fields
- **THEN** the runtime accepts the config and proceeds to parse the snapshot

#### Scenario: Unknown record kind is rejected

- **WHEN** a config declares a `kind` that is not one of the supported import artifact
  kinds
- **THEN** intake fails before parsing the snapshot or writing any database rows

#### Scenario: Unsupported target field is rejected

- **WHEN** a config maps a value to a target field that the declared kind's record
  spec does not define
- **THEN** intake fails before parsing the snapshot or writing any database rows

### Requirement: Deterministic Snapshot Parsing

The runtime MUST parse the referenced snapshot deterministically: the same snapshot
bytes MUST always yield the same records. For the `xlsx` format the runtime MUST read
rows from the configured sheet keyed by header, and MUST fail before any database
write when the snapshot is missing, unreadable, or not the declared format.

#### Scenario: xlsx snapshot is parsed into rows

- **WHEN** the config declares `format: xlsx` and the snapshot is a readable workbook
- **THEN** the runtime reads its rows keyed by column header and maps them per the
  config

#### Scenario: Parsing is deterministic

- **WHEN** the same snapshot file is parsed twice
- **THEN** the runtime produces the identical set of records both times

#### Scenario: Unreadable or wrong-format snapshot fails early

- **WHEN** the snapshot is missing, unreadable, or not the declared format
- **THEN** intake fails before reading `SourceNameToCanonicalId` records or writing any
  database rows

### Requirement: Source-Local Identity Keying

Each emitted record MUST be keyed by the source-local identity value selected by the
config's `identity`. The command MUST NOT generate canonical database ids; canonical
cuid2 assignment and persistence MUST remain the responsibility of the existing
pipeline's `SourceNameToCanonicalId` state.

#### Scenario: Record key comes from the configured identity

- **WHEN** a Personnel config declares `identity: { from: [post_id] }` and a row has
  POST ID `12345`
- **THEN** the emitted `Artifacts` record for that row is keyed by `12345`, and the
  existing pipeline mints or reuses the canonical cuid2 for that source-local key

#### Scenario: The command assigns no canonical ids

- **WHEN** `intake run` builds the `Artifacts` envelope
- **THEN** the envelope contains source-local record keys only and no canonical
  database ids

#### Scenario: Re-running the same snapshot is not a second import

- **WHEN** an operator runs the same source against a snapshot whose `Artifacts`
  identity already imported
- **THEN** the existing-import guard prevents a duplicate import rather than creating
  conflicting rows

### Requirement: Kind-Agnostic and Additive Emission

The command MUST emit exactly the record kinds declared in the config and MUST NOT
assume any particular kind is present. Records absent from a snapshot MUST NOT produce
delete mutations; the command MUST only express records present in the parsed
snapshot.

#### Scenario: Only declared kinds are emitted

- **WHEN** a config declares only `Personnel` records
- **THEN** the emitted `Artifacts` envelope contains only `Personnel` records and no
  `Agencies` or other kinds

#### Scenario: Disappearance does not delete

- **WHEN** a later snapshot no longer contains a record that a prior snapshot included
- **THEN** the command emits no delete mutation for the absent record

### Requirement: Reuse of the Existing Import Pipeline and Change Record

The command MUST produce the durable record of what changed by reusing the existing
`DatabaseMutations` envelope written to the command directory. This slice MUST NOT
introduce a new durable change-record type and MUST NOT emit any external change
event.

#### Scenario: Import produces the existing durable artifacts

- **WHEN** a non-dry-run `intake run` completes successfully
- **THEN** a `DatabaseMutations` envelope is written to the command directory by the
  existing pipeline and the database mutations are applied

#### Scenario: No new change type or transport is introduced

- **WHEN** `intake run` completes
- **THEN** intake writes no new change-record envelope kind and emits no external
  event or message
