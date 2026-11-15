# officer-reporting-spreadsheet Specification

## Purpose

TBD - created by archiving change add-officer-reporting-spreadsheet. Update Purpose after archive.

## Requirements

### Requirement: Preserve spreadsheet and article evidence

The source SHALL preserve original spreadsheet bytes, row references, embedded
hyperlink targets, article response bodies, retrieval results, and digests.

#### Scenario: A linked article cannot be retrieved

- **WHEN** an article request fails or is rejected
- **THEN** its URL and failure remain inspectable and it is not reported as mapped

### Requirement: Associate coverage with supported officer identities

The source SHALL use reviewed article evidence for the officer's name and
employing agency, resolve them through shared intake resolvers, and emit existing
coverage-link artifacts only for resolved associations. Unresolved records SHALL
remain inspectable. Allegation labels SHALL remain attributed source statements.
The resolved agency's state SHALL agree with the reviewed identity's state.

#### Scenario: Named officer and agency resolve

- **WHEN** a saved article supports an officer's name and agency and both resolve
- **THEN** the source emits a coverage link and agency-personnel association with
  the supporting passage and spreadsheet provenance

#### Scenario: Identity cannot be resolved

- **WHEN** an officer or agency cannot be uniquely resolved
- **THEN** the source reports that row as unresolved without inventing a person
