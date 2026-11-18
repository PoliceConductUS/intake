## MODIFIED Requirements

### Requirement: Import Logging And Progress

The intake CLI MUST use pino to write structured logs for the import that `data generate` runs and for `replay database-mutations` to `<command-name>.log` in the command folder of the command being executed, `$INTAKE_WORKSPACE/command/<timestamp>-<command-name>/`. Each is a command log as the `command-logs` capability defines it: it is closed when the command ends, a caught error is its last record, and `replay database-mutations` prints each record's `msg` to stdout.

#### Scenario: Artifacts import log is command-local

- **WHEN** an operator runs `intake data generate <source-id>`
- **THEN** intake creates a command folder under `$INTAKE_WORKSPACE/command/` for the import
- **AND** intake appends structured pino log records to `<command-name>.log` in that command folder
- **AND** intake does not write the import log to any workspace-root log path

#### Scenario: Import log is command-local

- **WHEN** an operator runs `intake replay database-mutations /path/to/<name>.DatabaseMutations.yaml`
- **THEN** intake creates a command folder under `$INTAKE_WORKSPACE/command/`
- **AND** intake appends structured pino log records to `<command-name>.log` in that command folder
- **AND** intake does not write the replay log to any workspace-root log path

#### Scenario: Terminal progress is human-readable

- **WHEN** the import that `data generate` runs succeeds
- **THEN** its log holds records that name the log file path, the Artifacts file being imported, and the reading of the Artifacts
- **AND** its success record reports the total number of `DatabaseMutations` written
- **AND** its success record reports record counts by parsed mutation `recordKind`, such as `LocationPath`, `LocationPathAlias`, `Agency`, `Personnel` and `AgencyPersonnel`, and does not hard-code reporting to only agency, personnel or agency-personnel mutations
- **AND** `replay database-mutations` prints the `msg` of each of its records to stdout as a plain line

#### Scenario: A failed import or replay records its error

- **WHEN** the import or the replay fails after its log is open
- **THEN** the log's last record is that error, with its message and stack and with no `msg`
- **AND** the command exits non-zero

#### Scenario: Log level controls observability

- **WHEN** `.env` or the process environment sets `LOG_LEVEL=debug`
- **THEN** intake writes the debug-level pino records of the import or replay to its log
- **AND** a terminal stream the command prints to shows those debug messages in human-readable form
