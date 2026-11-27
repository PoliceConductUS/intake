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
