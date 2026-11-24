## MODIFIED Requirements

### Requirement: Successful phase outputs are required

Generation and internal artifact import SHALL require a recorded successful transformation of exactly the acquires they take as input, each listed in the namespace's `acquire.yaml`, whose input snapshot and output integrity still match; for a standalone source the recorded input SHALL be none. They SHALL reject missing completion evidence, changed input, changed artifacts, a recorded transformation of other acquires, and a failed newer transformation rather than silently selecting older output. The current generation SHALL consume only its own mutation output. Explicit standalone/manual sources SHALL retain their existing no-network-acquisition semantics.

#### Scenario: Helper-created or stale artifacts

- **WHEN** generation is given unrecorded artifacts or artifacts whose source inputs or output bytes changed
- **THEN** it fails before appending or applying database mutations

#### Scenario: Transform fails after a previous success

- **WHEN** a newer transform attempt fails
- **THEN** generation fails instead of selecting an older successful transform

#### Scenario: The recorded transformation is of other acquires

- **WHEN** generation takes a list of acquires as input and the recorded successful transformation read a different list
- **THEN** it fails before appending or applying database mutations
