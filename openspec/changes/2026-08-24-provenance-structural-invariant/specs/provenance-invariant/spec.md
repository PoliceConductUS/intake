## ADDED Requirements

### Requirement: Displayable Values Require Provenance To Exist

Every value that can appear on a public page MUST be stored as a claim carrying
a non-null reference to a source retrieval, and a retrieval MUST carry a source,
a retrieval timestamp, and a locator.

#### Scenario: Claim without a retrieval is rejected

- **WHEN** a claim is inserted without `retrieval_id`
- **THEN** the database rejects the write with a not-null violation

#### Scenario: Retrieval without a locator is rejected

- **WHEN** a source retrieval is inserted with neither `source_url` nor `records_request_id`
- **THEN** the database rejects the write with `source_retrieval_locator_required`

#### Scenario: Records-request identifier is an acceptable locator

- **WHEN** a source retrieval is inserted with `records_request_id` and no `source_url`
- **THEN** the write succeeds and the identifier is preserved

#### Scenario: Confidence must be within (0, 1]

- **WHEN** a claim is inserted with `confidence` of 0 or greater than 1
- **THEN** the database rejects the write

#### Scenario: Retrieval records cannot be rewritten

- **WHEN** an update or delete is attempted against `source_retrieval`
- **THEN** the database rejects it as append-only

### Requirement: Displayable Fields Are Registered

A claim MUST reference a registered predicate, and its populated value column
MUST match the predicate's declared datatype and subject type.

#### Scenario: Unregistered predicate is rejected

- **WHEN** a claim references a predicate with no `claim_predicate` row
- **THEN** the database rejects the write

#### Scenario: Datatype mismatch is rejected

- **WHEN** a claim populates `value_text` for a predicate declared as `number`
- **THEN** the database rejects the write

### Requirement: Source-Asserted Absence Is Cited

A source that records no value for a field MUST be representable as a cited
absence, distinct from a value we have not sought, and MUST NOT be silently
backfilled from another source.

#### Scenario: Absent value renders with a citation

- **WHEN** a published claim has `value_absent = true`
- **THEN** the render surface returns `absent: true`, a null value, and a complete citation

### Requirement: The Render Path Cannot Read An Uncited Value

The page-build role MUST NOT hold any privilege on a table that can contain an
uncited value, and the render surface MUST NOT expose a value separably from
its citation.

#### Scenario: Render role cannot read base tables

- **WHEN** the `page_renderer` role selects from `public.claim`, `public.agency`, or `public.officers`
- **THEN** the database denies permission

#### Scenario: Render surface exposes no bare value column

- **WHEN** the `page_renderer` role selects `value_text` from `render.published_claim`
- **THEN** the query fails because no such column exists

#### Scenario: Value and citation are one column

- **WHEN** the `page_renderer` role selects `cited_value` for a published claim
- **THEN** the returned jsonb contains the value and its source, publisher, retrieval date, locator, locator type, confidence, and confidence basis

#### Scenario: Staged claims are invisible to the render path

- **WHEN** a claim has `publication_status` other than `published`
- **THEN** it does not appear in `render.published_claim`

### Requirement: Publication Is Refused For Ineligible Claims

A claim MUST NOT be publishable when its predicate is not renderable, when its
backing source is not terms-cleared, or when its corroboration threshold is
unmet. Publication is refused, never silently downgraded.

#### Scenario: Non-renderable predicate cannot be published

- **WHEN** a claim on a predicate with `renderable = false` is set to `published`
- **THEN** the database rejects the write

#### Scenario: Uncleared source cannot back a published claim

- **WHEN** a claim whose source has `terms_status` other than `cleared` is set to `published`
- **THEN** the database rejects the write

### Requirement: Publication Status Changes Are Audited

Every publication-status transition MUST write an append-only audit event
recording the prior status, the new status, and the actor.

#### Scenario: Transitions are recorded automatically

- **WHEN** a claim is inserted and then moved through `published` and `blocked`
- **THEN** `publication_event` contains one row per transition with correct `from_status` and `to_status`

#### Scenario: Audit trail cannot be edited

- **WHEN** an update or delete is attempted against `publication_event`
- **THEN** the database rejects it as append-only

### Requirement: Subjects Can Be Suppressed Immediately

An active suppression on a subject MUST remove it from every render surface
regardless of individual claim status, and lifting it MUST restore visibility.

#### Scenario: Suppression removes a subject from render

- **WHEN** an unlifted `subject_suppression` row exists for a subject
- **THEN** no claim for that subject appears in `render.published_claim`

#### Scenario: Lifting a suppression restores render

- **WHEN** the suppression is lifted with a `lifted_by` and `lifted_at`
- **THEN** the subject's published claims appear again

### Requirement: The Invariant Is Verifiable In CI

The database MUST expose a check that reports any weakening of the render
isolation, and it MUST fail the build when violated.

#### Scenario: Clean database reports no violations

- **WHEN** `public.assert_provenance_invariant()` runs on a correctly migrated database
- **THEN** it returns zero rows

#### Scenario: A later grant to a base table is detected

- **WHEN** `page_renderer` is granted SELECT on `public.claim`
- **THEN** the check reports `renderer_reads_base_table` naming that table

#### Scenario: Opening the personnel gate is detected

- **WHEN** `page_renderer` is granted SELECT on `render.published_person`
- **THEN** the check reports `personnel_gate_open`

### Requirement: The Personnel Publication Gate Is Closed By Construction

Named-personnel data MUST NOT be publicly renderable, and opening the gate MUST
require an explicit reviewable migration rather than a configuration change.

#### Scenario: Render role has no access to the personnel view

- **WHEN** the `page_renderer` role selects from `render.published_person`
- **THEN** the database denies permission

#### Scenario: A published employment still renders nothing

- **WHEN** an `employment_period` is set to `published`
- **THEN** `render.published_person` still returns zero rows

#### Scenario: Employment defaults to staged

- **WHEN** an `employment_period` is inserted without an explicit status
- **THEN** its `publication_status` is `staged`
