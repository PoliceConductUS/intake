## ADDED Requirements

### Requirement: Reset and regenerate the database from sources

`data reset` SHALL reset the database configured by `DATABASE_URL` to the repository's current schema migrations without legacy seed loading, retire the active mutation chain into the reset command's output, and generate and apply a new chain from sources. It SHALL preserve existing acquired inputs, source-name identity mappings, resolved-property state including canonical slugs, and durable manual records. It SHALL process automatic sources in dependency order and process the manual source last. Each source's generated changes SHALL be applied before processing the next source.

#### Scenario: Rebuild without acquisition

- **WHEN** the operator runs `data reset --no-acquire`
- **THEN** the command resets the database, retires the old chain, and runs transform, generate, and apply using existing inputs
- **AND** it does not invoke acquisition or replay retired mutations

#### Scenario: Default reset includes acquisition

- **WHEN** the operator runs `data reset`
- **THEN** each automatic source runs acquire, transform, generate, and apply in dependency order
- **AND** existing manual records are transformed, generated, and applied without prompting for new manual input

#### Scenario: Required location cannot be resolved

- **WHEN** source generation fails because a required location cannot be resolved
- **THEN** reset stops with a nonzero exit status identifying the failed source and phase and reports that the rebuild is incomplete
- **AND** it does not replace the failure with old generated data

#### Scenario: Schema reset fails

- **WHEN** resetting the configured database fails
- **THEN** the existing mutation chain remains in its original location and source processing does not begin

#### Scenario: Repeat a rebuild

- **WHEN** the operator repeats a reset with unchanged sources and retained identity state
- **THEN** the rebuilt rows retain their canonical IDs and slugs
