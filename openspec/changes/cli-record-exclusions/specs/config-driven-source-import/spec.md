## ADDED Requirements

### Requirement: CLI authors source record exclusions

The CLI SHALL support `data exclude <source> <kind> <source-id> --reason <reason>` using the singular record kind and source-local identity. It SHALL append the entry to the existing source `excluded.yaml` through shared exclusion IO, preserving existing entries and comments. The source must exist, the kind must be produced by that source, and the source ID and reason must be nonblank. An already excluded identity SHALL fail with its existing reason instead of overwriting it.

The command SHALL report the saved file and the transform and generate commands needed to use the exclusion. The existing transform exclusion cascade SHALL remove dependent records referencing an excluded record. Excluding an agency does not remove independent Personnel records. Raw inputs, previous artifacts, cache values, and existing database rows SHALL remain unchanged.

#### Scenario: Exclude the Alabama placeholder

- **WHEN** the operator excludes `gov.tx.tcole Agency 515001` with a reason
- **THEN** the source exclusion list contains that identity and reason
- **AND** the next transform excludes the agency and dependent assignments while retaining independent personnel
- **AND** the exclusion remains effective on subsequent transforms and resets

#### Scenario: Invalid or duplicate exclusion

- **WHEN** the source or kind is unknown, the source ID or reason is blank, or that identity is already excluded
- **THEN** the command fails and leaves the exclusion file unchanged
