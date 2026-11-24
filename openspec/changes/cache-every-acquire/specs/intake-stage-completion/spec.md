## MODIFIED Requirements

### Requirement: Local inputs do not bypass acquisition

For a source with an acquisition module, intake SHALL run that module on locally staged inputs before promoting them as completed acquisition. Failure SHALL NOT promote incomplete input. A module whose calls go through the cache SHALL, on failure, keep in the cache every call result and file it obtained. Sources without an acquisition module SHALL continue to support local input acquisition.

#### Scenario: Locally seeded analysis fails

- **WHEN** source files are supplied with `--from-local` and a call the acquisition module requires fails
- **THEN** acquisition fails and does not publish the incomplete snapshot as successful
- **AND** a module whose calls go through the cache keeps in the cache the call results and files it obtained

#### Scenario: Completed cached input

- **WHEN** all required acquisition work is already cached
- **THEN** acquisition reuses that work and completes without repeating a call whose call result stands
