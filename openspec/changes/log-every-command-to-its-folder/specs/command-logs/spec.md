## ADDED Requirements

### Requirement: A command that creates a command folder writes its log there

Every intake command that creates a command folder SHALL write `<command-name>.log` in that folder with `createIntakeLog`, at the level `LOG_LEVEL` names. Each progress line the command prints SHALL also be a record in that log.

#### Scenario: An acquire

- **WHEN** an operator runs `intake data acquire com/courtlistener/www/api`
- **THEN** the acquire's command folder holds `<command-name>.log`
- **AND** each line the acquire printed is a record in it

#### Scenario: A reset

- **WHEN** an operator runs `intake data reset`
- **THEN** the reset's command folder holds `<command-name>.log` with each phase it ran

### Requirement: A failed command records its error in its log

When a command that wrote a log fails, the last record in its log SHALL be the error that ended it, with its message and stack.

#### Scenario: An acquire that throws

- **WHEN** a source's acquire throws after the command folder was created
- **THEN** the log's last record is that error
- **AND** the command exits non-zero as it does today
