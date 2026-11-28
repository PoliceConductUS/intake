## ADDED Requirements

### Requirement: Transforming every source skips only a source with no acquired input

`data transform` with no source SHALL transform every source in dependency order. It SHALL skip a source only when that source has no acquired input, and SHALL recognise that case by a named error type, not by the error's message. Every other error a source throws or returns SHALL be listed with the source under "errored", the remaining sources SHALL still be transformed, and the command SHALL exit non-zero. The summary SHALL give the number of skipped sources and list each one.

#### Scenario: Sources with no acquired input

- **WHEN** `data transform` runs with no source and some sources have no acquired input
- **THEN** each of those sources is listed as skipped, with the number of skipped sources
- **AND** the command exits 0 when no source errored

#### Scenario: A source fails for another reason

- **WHEN** `data transform` runs with no source and one source throws an error other than having no acquired input, such as an invalid acquire pointer
- **THEN** that source and its error are listed under "errored", not as skipped
- **AND** the other sources are still transformed or skipped
- **AND** the command exits non-zero

#### Scenario: One named source with no acquired input

- **WHEN** `data transform <source>` runs for a source with no acquired input
- **THEN** the command fails and tells the operator to acquire that source first
