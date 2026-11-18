## ADDED Requirements

### Requirement: Acquire, transform, reset, cache and photo commands write a log in their command folder

`data acquire` (with or without `--from-local`), `data transform` (including each transform that `data update` and `data reset` run), `data reset`, `cache set`, `cache unset`, `cache alias` and `photo import` SHALL write `<command-name>.log` as pino JSON records, at the level `LOG_LEVEL` names (default `info`), in each command folder they create. A progress line is a line the command or its source writes through that log; each SHALL be an `info` record whose `msg` is that line.

#### Scenario: An acquire

- **WHEN** an operator runs `intake data acquire com/courtlistener/www/api`
- **THEN** the acquire's command folder, `$INTAKE_WORKSPACE/command/<timestamp>-<command-name>/`, holds `<command-name>.log`
- **AND** each progress line the acquire or its source wrote is a record in it

#### Scenario: An acquire of several sources

- **WHEN** an operator runs `intake data acquire` with a glob that matches several sources
- **THEN** each source acquired has its own command folder, and each folder holds its own log
- **AND** the acquire stops at the first source that fails, whose log, if it opened one, ends with its error

#### Scenario: A transform

- **WHEN** an operator runs `intake data transform <source-id>`
- **THEN** the transform's command folder holds `<command-name>.log`
- **AND** each progress line the transform wrote, such as an exclusion line, is a record in it

#### Scenario: The transforms an update runs

- **WHEN** an operator runs `intake data update`
- **THEN** each source's transform writes `<command-name>.log` in its own command folder

#### Scenario: A reset

- **WHEN** an operator runs `intake data reset`
- **THEN** the reset's command folder holds `<command-name>.log`
- **AND** each `data reset:` progress line, which names each command it runs in order, and the final stdout of each `data` command it ran, is a record in it
- **AND** each `data acquire`, `data transform` and `data generate` it ran is its own command, with its own command name, command folder and log

#### Scenario: A cache set that succeeds

- **WHEN** an operator runs `intake cache set` and it succeeds
- **THEN** its command folder holds `<command-name>.log`, which has no records, because the command writes no progress lines

### Requirement: The terminal shows the same progress lines

With `LOG_LEVEL` unset or at `info`, `debug` or `trace`, each progress line of `data acquire`, `data transform` and `data reset` SHALL be printed to stderr. `LOG_LEVEL` SHALL filter the terminal and the log together. A command's own final stdout, and its final stderr message on failure, SHALL NOT be progress lines.

#### Scenario: A progress line at the default level

- **WHEN** a source's acquire writes a progress line and `LOG_LEVEL` is unset
- **THEN** the line is printed to stderr and is a record in the log

#### Scenario: A level above info

- **WHEN** `LOG_LEVEL` is `warn`
- **THEN** progress lines are neither printed nor recorded

### Requirement: Each record is on disk before the command continues

Each log record SHALL be written to the file before the command continues, so a run that is killed keeps every record it wrote.

#### Scenario: A record written before the next line

- **WHEN** a source's acquire writes a progress line
- **THEN** the line is a record in the log file before the source's next statement runs

### Requirement: A failed command records its error in its log

When a command that creates a command folder fails with an error it catches after its log is open, and `LOG_LEVEL` is `error` or lower, the last record SHALL be that error: a record at level `error` (pino level 50), with no `msg`, whose `error` field is pino's serialization of the thrown value. For an `Error` that is its type, its message and stack with its causes appended, and its other enumerable properties.

#### Scenario: An acquire that throws

- **WHEN** a source's acquire throws after its log is open
- **THEN** the log's last record is that error, with its message and stack
- **AND** the terminal shows the error message once
- **AND** the command exits non-zero

#### Scenario: A cache set that fails

- **WHEN** `intake cache set` fails after its log is open
- **THEN** the log's last record is that error, with its message and stack
- **AND** the command exits non-zero

### Requirement: A command closes its log when it ends

Each command SHALL close its log when it ends, whether it succeeds or fails, and SHALL write no record to it after closing it.

#### Scenario: A finished transform

- **WHEN** a transform ends
- **THEN** its log is closed before the transform returns

### Requirement: A process that ends early records why in each open log

When the intake process receives `SIGINT` or `SIGTERM`, exits while a command log is still open, or ends on an uncaught exception or unhandled rejection, the CLI SHALL write a final record to each command log still open, then end the process as it would have ended without the record. The record SHALL be at level `error` with no `msg`, and SHALL name the signal, the exit code, or the serialized error.

#### Scenario: An interrupted acquire

- **WHEN** an operator presses Ctrl-C during an acquire
- **THEN** the acquire's log ends with a record naming `SIGINT`
- **AND** the process ends as an interrupted process

#### Scenario: A promise that never settles

- **WHEN** an acquire waits on a promise that never settles and the process exits
- **THEN** the acquire's log ends with a record naming the exit code

#### Scenario: An unhandled rejection

- **WHEN** a rejection that no code handles ends the process during a transform
- **THEN** the transform's log ends with that error, with its message and stack
- **AND** the process exits non-zero

### Requirement: An unknown log level fails before the command folder is created

When `LOG_LEVEL` is set to a value that is not a pino level (`fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`), including an empty value, a command that creates a command folder SHALL fail before creating it, with a message that names the value.

#### Scenario: A misspelled level

- **WHEN** an operator runs `intake data acquire <source-id>` with `LOG_LEVEL=inf`
- **THEN** the command exits non-zero with a message naming `inf`
- **AND** no command folder is created

#### Scenario: An empty level

- **WHEN** an operator runs `intake data acquire <source-id>` with `LOG_LEVEL=` (set, but empty)
- **THEN** the command exits non-zero with a message naming the empty value
- **AND** no command folder is created

### Requirement: Secret values are redacted from every record

Before a record is written to a log or the terminal, each value of a `PARAMETER_STORE_SECRETS` name that the command has read from Parameter Store SHALL be replaced by `[redacted]` wherever it appears in the record.

#### Scenario: An error that carries an API key

- **WHEN** a source's acquire reads `SERPAPI_KEY` and then throws an error whose message holds a request URL with that key
- **THEN** the log's error record holds `[redacted]` where the key was, and the key appears nowhere in the log
