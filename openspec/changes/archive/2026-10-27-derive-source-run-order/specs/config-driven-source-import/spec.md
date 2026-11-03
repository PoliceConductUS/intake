## MODIFIED Requirements

### Requirement: Source Module Contract

A source's config MUST be a `config.ts` module under `sources/<source-id>/` that exports
a deterministic `run` function. `run` MUST read the CLI-provided paths and **return** an
`Artifacts` manifest describing the records it generated; it MUST NOT emit through an
injected callback, perform the import, assign canonical ids, or write to the database.
`run` MUST be deterministic for its inputs: the same input bytes MUST produce the same
returned manifest, with no dependence on network access, wall-clock time, or randomness.
The module MUST also export a valid `produces` declaration as specified by derive-source-run-order. The runtime MUST fail before running when the module does not export `run` or a valid `produces` declaration.

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


#### Scenario: Missing produces fails early

- **WHEN** a source module omits its `produces` declaration
- **THEN** the runtime fails before invoking the source or writing database rows
