## ADDED Requirements

### Requirement: Correction Requests And Takedown Demands Are Recorded Verbatim

An arriving correction request or takedown demand MUST be recorded with its
channel, kind, and the requester's own words. The substance of a request MUST
NOT be editable after intake, and a request MUST NOT be deletable.

#### Scenario: A request is recorded with the requester's own words

- **WHEN** a correction request is inserted
- **THEN** the row is stored with disposition `received` and the request text unchanged

#### Scenario: Request substance cannot be rewritten

- **WHEN** an update attempts to change `request_text`, requester identity, channel, kind, or `received_at`
- **THEN** the database rejects it as immutable after intake

#### Scenario: A request cannot be deleted

- **WHEN** a delete is attempted against `correction_request`
- **THEN** the database rejects it

#### Scenario: A resolved request must name who decided

- **WHEN** a request is set to `action_taken` or `declined` without `decided_at` and `decided_by`
- **THEN** the database rejects the write with `correction_request_resolution_attributed`

### Requirement: Legal Determinations Are Routed, Not Made

A request of kind `legal_demand` or `sealed_or_expunged` MUST NOT be resolved
without having been escalated first. A suspected sealed or expunged record MUST
NOT be declined.

#### Scenario: An unescalated legal demand cannot be resolved

- **WHEN** a `legal_demand` request is set to `action_taken` with `escalated_at` null
- **THEN** the database rejects it and names the Executive Director as the route

#### Scenario: A legal demand can be escalated

- **WHEN** a `legal_demand` request is set to `escalated` with `escalated_at` and `escalated_to`
- **THEN** the write succeeds

#### Scenario: A suspected sealed record cannot be declined

- **WHEN** a `sealed_or_expunged` request is set to `declined`, even after escalation
- **THEN** the database rejects it

### Requirement: Suppression Removes A Subject From The Public Surface

An active suppression MUST remove its subject from every render view.

#### Scenario: A suppressed subject stops rendering

- **WHEN** a subject with published claims is suppressed
- **THEN** `render.published_claim` returns no rows for that subject

#### Scenario: The invariant self-check confirms no suppressed subject is reachable

- **WHEN** `public.assert_suppression_invariant()` is called with an active suppression in place
- **THEN** it returns zero rows

### Requirement: Suppression Is Anchored To The Upstream Record Key

Applying a suppression MUST record the `(source_id, source_record_key)` pairs
behind the subject, so that suppression does not depend on the durability of a
canonical ID mapping.

#### Scenario: Source keys are captured when a suppression is applied

- **WHEN** a subject with claims is suppressed
- **THEN** `suppression_source_key` holds one row per distinct source and source record key behind that subject

### Requirement: A Re-Import Cannot Reintroduce A Suppressed Record

The ingestion pipeline MUST NOT be able to overwrite, delete, or reintroduce a
suppressed record, whether or not the canonical ID from the original
suppression survived.

#### Scenario: Re-import under the same canonical ID is refused

- **WHEN** the ingestion role writes a claim for a suppressed subject
- **THEN** the database rejects it and names the active suppression

#### Scenario: Re-import of the same upstream row under a NEW canonical ID is refused

- **WHEN** the ingestion role writes a claim whose subject ID has no suppression of its own, but whose `(source_id, source_record_key)` is covered by an active suppression
- **THEN** the database rejects it and names the active suppression

#### Scenario: In-place update of a suppressed entity row is refused

- **WHEN** the ingestion role updates `public.agency` or `public.officers` for a suppressed row
- **THEN** the database rejects it

#### Scenario: Delete-and-recreate of a suppressed entity row is refused

- **WHEN** the ingestion role deletes a suppressed row from `public.agency` or `public.officers`
- **THEN** the database rejects it

#### Scenario: The subject stays off the render surface after a re-run attempt

- **WHEN** a re-import attempt against a suppressed subject has been refused
- **THEN** the subject is still absent from `render.published_claim` and the invariant self-check returns zero rows

### Requirement: The Ingestion Role Cannot Change Suppression State

The ingestion role MUST hold SELECT and nothing else on the suppression tables,
so that suppression cannot be undone by the pipeline even if a trigger is later
removed.

#### Scenario: The ingestion role cannot lift or delete a suppression

- **WHEN** the ingestion role attempts to update or delete `subject_suppression`
- **THEN** the database rejects it with permission denied

#### Scenario: The ingestion role cannot forge a source key

- **WHEN** the ingestion role attempts to insert into `suppression_source_key`
- **THEN** the database rejects it with permission denied

#### Scenario: The ingestion role can read suppression state

- **WHEN** the ingestion role calls `is_source_key_suppressed`
- **THEN** it returns the active suppression id, so the planner can skip the record

#### Scenario: Re-granting write access fails the build

- **WHEN** a later migration grants the ingestion role UPDATE on `subject_suppression`
- **THEN** `assert_suppression_invariant()` returns `intake_can_modify_suppression`

### Requirement: Suppression Actions Are Logged And Cannot Be Erased

Applying and lifting a suppression MUST write an append-only audit event naming
the actor, reason, and basis. A suppression MUST NOT be deletable, and its
reason and subject MUST NOT be rewritable.

#### Scenario: Applying a suppression writes an audit event

- **WHEN** a suppression is applied
- **THEN** `publication_event` holds a subject-level row with `to_status` `blocked`, the reason code, the basis, and the acting actor

#### Scenario: A suppression cannot be deleted

- **WHEN** a delete is attempted against `subject_suppression`
- **THEN** the database rejects it and directs the caller to lift it instead

#### Scenario: The reason for a suppression cannot be rewritten

- **WHEN** an update attempts to change `reason_code`, the subject, or who applied it
- **THEN** the database rejects it as lift-fields-only

#### Scenario: Lifting requires a stated basis

- **WHEN** a suppression is lifted without `lift_note`
- **THEN** the database rejects it

### Requirement: Lifting A Suppression Does Not Republish

Lifting a suppression MUST return the subject's published claims to `staged`.

#### Scenario: A lifted subject does not return to the public surface

- **WHEN** a suppression is lifted with a stated basis
- **THEN** the subject's claims are `staged`, the subject is absent from `render.published_claim`, and a `staged` audit event names the lifting actor and the basis

### Requirement: The Public Corrections Log Does Not Re-Identify People

The public corrections log MUST name agencies, MUST NOT disclose the subject of
a person-level action, and MUST NOT expose requester identity.

#### Scenario: An agency correction is named

- **WHEN** an agency record is withheld
- **THEN** `render.corrections_log` shows the agency subject id, the action, and a plain-language reason

#### Scenario: A person-level action is not attributed

- **WHEN** a person record is withheld
- **THEN** `render.corrections_log` shows the action and reason with a null subject id

#### Scenario: Requester identity is not exposed

- **WHEN** the corrections log view and the page role's grants are inspected
- **THEN** no requester column is present and the page role holds no privilege on `correction_request`
