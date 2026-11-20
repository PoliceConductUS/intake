## MODIFIED Requirements

### Requirement: Validate retained inputs before destructive reset

Reset SHALL inventory and transform every listed automatic acquire before clearing the configured database or retiring the active mutation chain. A source without a completed acquisition MAY acquire during default reset. A malformed acquire list or input SHALL fail. Standalone manual sources SHALL retain their existing replay-only behavior. Preparation outputs SHALL NOT be used for generation; transforms SHALL run again against the rebuilt database. Default acquisition SHALL retain its existing timing after upstream producers are applied. A preparation failure SHALL leave the database, active mutation chain, and acquire lists unchanged. Successful preparation SHALL preserve existing source dependency order, chronological replay and standalone-source behavior.

#### Scenario: A retained acquisition has obsolete analysis

- **GIVEN** retained input includes an analysis from an obsolete prompt
- **WHEN** reset prepares the inputs
- **THEN** reset fails before schema reset or mutation application
- **AND** the acquire list is unchanged
