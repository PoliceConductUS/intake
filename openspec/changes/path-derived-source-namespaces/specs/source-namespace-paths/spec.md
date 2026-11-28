## ADDED Requirements

### Requirement: Derive the source namespace from its marked folder

Intake SHALL discover source modules recursively by their `intake.source.ts` marker and derive each namespace from the folder path relative to the source root, with forward slashes between segments.

#### Scenario: Different feeds share a publisher

- **WHEN** two marked source folders have the same publisher prefix and distinct feed paths
- **THEN** source listing and execution use the two distinct complete namespace paths

#### Scenario: A source has only a request phase

- **WHEN** a marked folder supplies a request phase
- **THEN** it is listed with its supported phase and excluded from automatic database rebuilds

### Requirement: Export the Intake source contract

Each source's `intake.source.ts` SHALL export a definition satisfying the shared `IntakeSource` contract. Intake SHALL discover capabilities and execute operations through this definition. A transform SHALL declare the artifact kinds it produces.

#### Scenario: The implementation has a different filename

- **WHEN** a source exposes an operation backed by a differently named implementation file
- **THEN** Intake lists and runs that operation using the exported definition

#### Scenario: An operation is absent

- **WHEN** a marked source omits an operation but has a helper file bearing that operation's name
- **THEN** Intake does not advertise that operation and rejects an attempt to invoke it

### Requirement: Preserve existing identities when moving namespace paths

Intake SHALL use the same source namespace in source-scoped state, command outputs and persisted references. Migration SHALL preserve existing source records' canonical IDs, slugs and acquired input bytes.

#### Scenario: Rebuild after namespace migration

- **WHEN** a source with retained acquisitions and identity mappings is migrated and rebuilt without acquisition
- **THEN** its pointers resolve to the moved outputs, its inputs verify, and its existing records resolve to their prior canonical IDs

#### Scenario: A publisher URL is the external record key

- **WHEN** an article record uses a normalized URL as its source ID
- **THEN** the URL stays intact as the source ID under its source's nested namespace

### Requirement: Retain successful acquisition executions across the workspace migration

Migration SHALL retain every successfully completed acquire execution with its original run ID, independent of the current acquisition pointer or record count. Migration SHALL use the source workspace read-only and write the migrated workspace to `dev`.

#### Scenario: An older successful acquire returned zero records

- **WHEN** a completed acquire produced zero records and a later acquisition became the current pointer
- **THEN** the earlier execution remains a completed acquisition under the new namespace

#### Scenario: An interrupted acquire left output files

- **WHEN** an acquire wrote files but did not complete successfully
- **THEN** migration does not mark it as a completed acquisition
