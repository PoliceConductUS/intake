# current-summary-prompts Specification

## Purpose

Require current prompt content for completed Minnesota analyses and validate retained inputs before destructive database reset.

## Requirements

### Requirement: Prompt content identifies completed Minnesota analyses

The Minnesota disciplinary-order prompt SHALL live in a separate UTF-8 text file. Its SHA-256 fingerprint SHALL identify the exact instructions used for a completed analysis. Acquisition reuse and transformation SHALL reject missing or noncurrent fingerprints. Editing the prompt SHALL invalidate prior completed results without a manual version increment. Acquisition SHALL reuse available source PDF and extracted text while regenerating stale analysis rather than accepting or relabeling it.

#### Scenario: The prompt changes after a summary is saved

- **GIVEN** a saved analysis identifies an earlier prompt fingerprint
- **WHEN** the current prompt text changes
- **THEN** transformation rejects that analysis and acquisition must generate a current result

### Requirement: Validate retained inputs before destructive reset

Reset SHALL inventory and transform every existing retained automatic acquisition before clearing the configured database or retiring the active mutation chain. A source without a completed acquisition MAY acquire during default reset. Malformed existing acquisition pointers and inputs SHALL fail. Standalone manual sources SHALL retain their existing replay-only behavior. Preparation outputs SHALL NOT be used for generation; transforms SHALL run again against the rebuilt database. Default acquisition SHALL retain its existing timing after upstream producers are applied. A preparation failure SHALL leave the database, active mutation chain, and acquisition pointers unchanged. Successful preparation SHALL preserve existing source dependency order, chronological replay and standalone-source behavior.

#### Scenario: A retained acquisition has obsolete analysis

- **GIVEN** retained input includes an analysis from an obsolete prompt
- **WHEN** reset prepares the inputs
- **THEN** reset fails before schema reset or mutation application and restores the acquisition pointer
