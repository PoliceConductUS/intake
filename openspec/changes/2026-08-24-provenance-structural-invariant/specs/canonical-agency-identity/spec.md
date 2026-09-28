## ADDED Requirements

### Requirement: ORI Form Is Recorded Explicitly

An ORI assignment MUST record which form the identifier takes, and the recorded
form MUST match the identifier's length.

#### Scenario: Form and length must agree

- **WHEN** a 9-character ORI is recorded with `ori_form = 'ori7'`
- **THEN** the database rejects the write with `agency_ori_form_length`

#### Scenario: A cross-form bridge key is derived, not asserted

- **WHEN** a 9-character ORI `TX0570000` is recorded
- **THEN** `ori7` is derived as `TX05700` and cannot be set independently

### Requirement: ORI Assignments Carry Provenance

An ORI assignment MUST reference a source retrieval and carry a confidence.

#### Scenario: ORI without a retrieval is rejected

- **WHEN** an `agency_ori` row is inserted without `retrieval_id`
- **THEN** the database rejects the write

### Requirement: ORI Conflicts Queue For Review

Conflicting ORI assignments MUST open a reviewed conflict rather than resolving
automatically, and affected agencies MUST NOT render while a conflict is open.

#### Scenario: Two agencies sharing an ORI open a conflict

- **WHEN** a second agency is assigned an ORI sharing an `ori7` with an existing agency
- **THEN** an open `ori_conflict` of type `same_ori_multiple_agencies` is created listing both agency IDs

#### Scenario: Conflicting agencies are withheld from render

- **WHEN** an `ori_conflict` for an `ori7` has status `open`
- **THEN** agencies holding that `ori7` do not appear in `render.published_agency`

#### Scenario: Closing a conflict requires attribution

- **WHEN** an `ori_conflict` is set to `resolved` without a resolver, timestamp, and note
- **THEN** the database rejects the write

### Requirement: Registry Absence Is A Recorded Finding

Absence of an agency from a registry MUST be representable as an explicit
finding distinct from the agency not existing.

#### Scenario: Absence is recorded per source per retrieval

- **WHEN** an agency confirmed by a state roster is not present in the federal registry
- **THEN** an `agency_registry_presence` row records `absent` against that source and retrieval

### Requirement: Departments Are Modeled Above Reporting Units

The schema MUST support grouping multiple ORI-holding reporting units under one
department-level entity, with the grouping carrying a confidence and evidence.

#### Scenario: Membership is evidence-backed

- **WHEN** an agency is attached to an `agency_entity`
- **THEN** the membership records a method, a confidence in (0, 1], and an evidence payload

#### Scenario: An agency belongs to at most one entity

- **WHEN** an agency is attached to a second `agency_entity`
- **THEN** the database rejects the write
