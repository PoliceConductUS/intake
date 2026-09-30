# resolver-field-omission Specification

## Purpose

TBD - created by archiving change federal-agency-office-parent. Update Purpose after archive.

## Requirements

### Requirement: Resolvers preserve source omission and explicit null

Every registered property resolver and shared resolver primitive SHALL preserve
omission without converting it to null. Missing required inputs MAY fail visibly;
resolvers MAY derive values from declared inputs. Explicit null for a nullable
source field SHALL remain a deliberate null assignment. Omitted fields SHALL NOT
clear stored values during updates, including nullable foreign keys and text.

#### Scenario: Exhaustive registered resolver regression

- **WHEN** each registered entity property is resolved with its source field omitted
- **THEN** it does not silently resolve to null
- **AND** tests cover every generated entity property automatically and shared
  unregistered reference/composed primitives directly

#### Scenario: Deliberate clearing

- **WHEN** an update explicitly supplies null for a nullable field
- **THEN** it clears the field, while omission leaves the stored field unchanged
