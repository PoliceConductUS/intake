## ADDED Requirements

### Requirement: CLI authors source record exclusions

The CLI SHALL support `data exclude <source> <kind> <source-id> --reason <reason>` using the singular record kind and source-local identity. It SHALL append the entry to `$INTAKE_WORKSPACE/state/<source>/excluded.yaml` through shared exclusion IO, preserving existing entries and comments. The source must exist, the kind must be produced by that source, and the source ID and reason must be nonblank. An already excluded identity SHALL fail with its existing reason instead of overwriting it.

The command SHALL report the saved file and the transform and generate commands needed to use the exclusion. The existing transform exclusion cascade SHALL remove dependent records referencing an excluded record. Excluding an agency does not remove independent Personnel records. Raw inputs, previous artifacts, cache values, and existing database rows SHALL remain unchanged.

#### Scenario: Exclude the Alabama placeholder

- **WHEN** the operator excludes `gov.tx.tcole Agency 515001` with a reason
- **THEN** the source exclusion list contains that identity and reason
- **AND** the next transform excludes the agency and dependent assignments while retaining independent personnel
- **AND** the exclusion remains effective on subsequent transforms and resets

#### Scenario: Invalid or duplicate exclusion

- **WHEN** the source or kind is unknown, the source ID or reason is blank, or that identity is already excluded
- **THEN** the command fails and leaves the exclusion file unchanged

#### Scenario: Workspace-owned exclusions

- **WHEN** the operator excludes a record in a configured workspace
- **THEN** the CLI writes the source exclusion list in that workspace and transform reads that same list
- **AND** the source checkout is unchanged and repository exclusion files are not read
- **AND** switching workspaces uses the selected workspace's own exclusions
- **AND** existing entries, comments, and reasons are preserved when moving the current exclusion list into the workspace

Correction audit files and the manual-place audit list SHALL reside under the workspace `audits/` directory. Manual records themselves remain in the existing manual source state; relocating audit files SHALL NOT modify those records, cached corrections, or pending database mutations.

### Requirement: Applied exclusions are visible during transform

Transform SHALL log each explicitly excluded record present in its source manifest,
including source namespace, record kind, source ID, and recorded reason. It SHALL
also log counts removed by kind, including dependent records removed by the existing
cascade. Exclusion entries absent from the source manifest SHALL NOT be reported
as removed records.

#### Scenario: Explicit exclusion with a recorded reason

- **WHEN** transform removes a source record listed in workspace exclusions
- **THEN** its source identity and recorded reason appear in the command log
- **AND** removal counts by kind include dependent records
- **AND** transform with no removed records prints no removal summary
