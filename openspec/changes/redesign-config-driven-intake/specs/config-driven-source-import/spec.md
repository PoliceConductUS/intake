## ADDED Requirements

### Requirement: Config-Driven Source Run Command

The intake CLI MUST provide `intake run <source-id> <snapshot-ref...> [--dry-run]`
accepting one or more snapshot files. It loads the source's transform config, parses
each referenced snapshot into records, emits a typed `Artifacts` envelope, and imports
it through the existing artifacts import pipeline. The command MUST NOT re-implement
identity assignment, mutation planning, or database apply; it MUST delegate those to
the existing pipeline. The snapshot format MUST be inferred from each file's extension,
not declared in config.

#### Scenario: Operator runs a configured source against a saved snapshot

- **WHEN** an operator runs `intake run gov.azpost.roster ./Officer-List.xlsx`
- **THEN** intake loads `sources/gov.azpost.roster/source.yaml`, parses the snapshot,
  builds an `Artifacts` envelope, and hands it to the existing import pipeline, which
  assigns canonical ids and applies `DatabaseMutations`

#### Scenario: Multiple snapshot files in one run

- **WHEN** an operator runs `intake run <source-id> file-a.xlsx file-b.xlsx`
- **THEN** intake parses each file and contributes the records from every file to the
  same import

#### Scenario: Dry-run plans without applying

- **WHEN** an operator runs `intake run <source-id> <snapshot-ref> --dry-run`
- **THEN** intake writes the planned `DatabaseMutations` envelope to the command
  directory and MUST NOT apply database mutations

#### Scenario: Command validates required arguments

- **WHEN** an operator runs `intake run` without a source id, or with a source id but
  no snapshot file
- **THEN** intake fails before parsing any snapshot or writing any database rows

#### Scenario: Unknown source id

- **WHEN** the `<source-id>` has no `sources/<source-id>/source.yaml`
- **THEN** intake fails with a clear error before parsing the snapshot or writing any
  database rows

### Requirement: Source Transform Configuration

A source's transform config MUST be a declarative file under `sources/<source-id>/`
declaring one or more record mappings. Each mapping MUST declare a target `kind`, a
`key` selecting the source column(s) that form the source-local record identity, and a
`map` from target record-spec fields to source column names (a `map` value MAY also be
a literal constant), and MAY declare a `filter`. The runtime MUST fail before parsing
when a mapping declares a `kind` that is not a supported import artifact kind. The
runtime MUST NOT re-validate which target fields are legal; validity of each mapped
record MUST be enforced by the target kind's existing envelope schema.

#### Scenario: Field map is target-field to source-column

- **WHEN** a Personnel mapping declares
  `map: { id: "POST ID", first_name: First, last_name: Last }`
- **THEN** each parsed row becomes a `Personnel` record whose `id`, `first_name`, and
  `last_name` are taken from that row's `POST ID`, `First`, and `Last` columns

#### Scenario: Invalid mapped record is rejected by the envelope

- **WHEN** a mapped record omits a field the target kind's spec requires (e.g.
  `last_name`)
- **THEN** the existing envelope validation rejects the record and intake fails loudly
  rather than importing a partial row

#### Scenario: Unknown record kind fails early

- **WHEN** a mapping declares a `kind` that is not a supported import artifact kind
- **THEN** intake fails before parsing the snapshot or writing any database rows

### Requirement: Optional Deterministic Row Filter

A mapping MAY declare a `filter`. When present, the runtime MUST evaluate it
deterministically for each parsed row and MUST exclude non-matching rows before
emitting records; an excluded row MUST NOT contribute a record of that kind. When no
`filter` is declared, every parsed row MUST contribute a record (subject to envelope
validation).

#### Scenario: Filter excludes unwanted rows

- **WHEN** a mapping declares a `filter` and a parsed row does not satisfy it
- **THEN** no record of that kind is emitted for that row

#### Scenario: No filter emits every row

- **WHEN** a mapping declares no `filter`
- **THEN** every parsed row contributes a record of that kind, subject to envelope
  validation

### Requirement: Deterministic Snapshot Parsing

The runtime MUST parse the referenced snapshot deterministically: the same snapshot
bytes MUST always yield the same records. The snapshot format MUST be inferred from the
file extension. For `xlsx` the runtime MUST read rows from the first sheet keyed by the
header row, and MUST fail before any database write when the snapshot is missing,
unreadable, or not a readable file of its inferred format.

#### Scenario: xlsx snapshot is parsed into rows

- **WHEN** the snapshot has an `.xlsx` extension and is a readable workbook
- **THEN** the runtime reads its rows from the first sheet keyed by column header and
  maps them per the config

#### Scenario: Parsing is deterministic

- **WHEN** the same snapshot file is parsed twice
- **THEN** the runtime produces the identical set of records both times

#### Scenario: Unreadable or wrong-format snapshot fails early

- **WHEN** the snapshot is missing, unreadable, or not a readable file of its inferred
  format
- **THEN** intake fails before reading `SourceNameToCanonicalId` records or writing any
  database rows

### Requirement: Source-Local Identity Keying

Each emitted record MUST be keyed by the source-local identity value selected by the
mapping's `key` (the value of the named source column(s); multiple columns MUST be
combined deterministically). The command MUST NOT generate canonical database ids;
canonical cuid2 assignment and persistence MUST remain the responsibility of the
existing pipeline's `SourceNameToCanonicalId` state.

#### Scenario: Record key comes from the configured key columns

- **WHEN** a Personnel mapping declares `key: [POST ID]` and a row has `POST ID` `12345`
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
