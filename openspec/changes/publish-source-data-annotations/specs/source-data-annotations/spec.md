## ADDED Requirements

### Requirement: Preserve reported values with native subject-linked annotations

Intake SHALL import identifiable source records despite factual data defects and persist ordinary `DataAnnotation` records linked to the affected record. Each annotation SHALL contain `field`, `value` (the inspected effective value for warnings/errors or original source value for corrections), `type`, `message`, `source_namespace`, and `source_record_id`. The canonical shared schema SHALL initially permit exactly `warning`, `error`, and `correction` as types. Annotations SHALL have durable canonical IDs allocated by the ordinary source-name ledger and be stored in public.data_annotation. Raw provenance SHALL remain intact. Structural failures in envelopes, identity, references or writes SHALL still fail visibly.

#### Scenario: Reversed employment dates

- **WHEN** TCOLE supplies start 2024-06-03 and end 2024-05-22
- **THEN** both dates and the assignment SHALL be imported and the generation stage SHALL attach an error on end_date stating that it precedes start_date
- **AND** the factual defect SHALL NOT remove the person or dependent records

#### Scenario: Value cannot fit its typed column

- **WHEN** a source date is the literal string "not a date"
- **THEN** the annotation SHALL preserve that exact string, identify the source record and explain the invalid value
- **AND** the affected descriptive typed field SHALL be empty without discarding its owner or asserting current employment

### Requirement: Distinguish errors from warnings

Demonstrable contradictions and invalid values SHALL be errors. Unusual but unproven facts SHALL be warnings. Existing duration thresholds SHALL trigger warnings rather than invalidity or omission. A future reported date SHALL remain visible with a warning rather than suppressing a scheduled record. Annotation wording SHALL distinguish our assessment from the provider's reported facts.

#### Scenario: Unusually long employment

- **WHEN** reported dates yield 125 years of employment
- **THEN** intake SHALL retain the dates and the generation stage SHALL attach a warning describing the unusually long reported duration
- **AND** the warning SHALL NOT claim the duration is false merely because it exceeds the existing threshold

#### Scenario: Scheduled future employment

- **WHEN** the source reports an employment start after the validation day
- **THEN** the assignment SHALL remain available for import with its reported future date and a warning

### Requirement: Generate annotations in the existing source flow

The existing `data generate <source>` flow SHALL inspect effective record values and persisted source evidence while generating record mutations. It SHALL include annotation changes in those same mutations, retain correction provenance, and remove obsolete findings even when source values are unchanged. Generation SHALL NOT write database records. There SHALL NOT be a separate annotation command or post-apply scan.

`data up` and replay SHALL only apply recorded mutations. They SHALL NOT recalculate annotations, including when no entries are pending. Update and reset SHALL use the same existing transform, generate, and up flow. The same input and validation day SHALL produce the same findings.

#### Scenario: Validation rule changes without source changes

- **WHEN** the same source is generated after an email-list validation fix
- **THEN** its mutation SHALL clear the obsolete invalid-email annotation while retaining the original source value

#### Scenario: Replay on another validation day

- **WHEN** generated mutations are applied on a different day
- **THEN** apply SHALL reproduce the generated annotations without recalculation

#### Scenario: No pending mutations

- **WHEN** data up has no pending entries
- **THEN** it SHALL NOT recalculate or change annotations

### Requirement: Carry applied corrections in generated mutations

Generated mutations SHALL carry correction annotations for overrides actually applied during the current run, including when the effective value equals the existing database value. A correction SHALL retain the original value, replacement_value, explanation in message, source_namespace, source_record_id and supporting evidence when supplied. Merely configured or nonmatching overrides SHALL NOT produce a correction annotation. Annotation changes SHALL be compared and persisted even if other field values do not change.

#### Scenario: Correction yields the already-stored value

- **WHEN** an address correction applies and its result already equals the stored address
- **THEN** its correction annotation SHALL still be included in the source contribution for the run
- **AND** a changed annotation set SHALL be persisted without requiring an address value change

### Requirement: Replace correction contributions by record and source identity

Correction reconciliation SHALL be scoped by producer identity and owning entity kind/canonical ID plus source_namespace plus source_record_id. Generation SHALL emit ordinary create/update mutations for active findings and mark obsolete intake-produced findings resolved. Other producers and unprocessed contributions SHALL survive. Apply SHALL execute the generated operations without annotation-specific behavior. Multiple mutations for one contribution in a run SHALL retain the complete run contribution. Generation SHALL inspect effective values after corrections, including current values preserved by partial updates.

#### Scenario: Two providers mutate one record

- **WHEN** sources A and B each produce corrections for the same canonical record
- **THEN** applying either source's contribution SHALL preserve the other source's correction annotations

#### Scenario: Two source IDs in the same namespace

- **WHEN** source records A1 and A2 in the same namespace contribute to one canonical record
- **THEN** replacing A1's correction set SHALL leave A2's set unchanged

#### Scenario: Processed source no longer applies corrections

- **WHEN** a source contribution is processed with no applied corrections
- **THEN** generation SHALL resolve only its previous intake-produced correction annotations

#### Scenario: Untouched source contribution

- **WHEN** a record or source contribution is not processed during the run
- **THEN** its correction annotations SHALL survive, including when another source is generated

#### Scenario: Correction and warning coexist

- **WHEN** a correction applies but the resulting effective value still triggers a warning
- **THEN** the generation stage SHALL retain the correction annotation and publish the warning for the resulting value

### Requirement: POST source issues attach to the licensing authority

Data issues detected while processing a POST source SHALL be retained as annotations on that source's explicitly identified licensing authority. This includes automatic omissions caused by missing identities or relationships, ambiguous source records, and explicit operator exclusions. A log message or aggregate omission count alone SHALL NOT satisfy this requirement. Each annotation SHALL preserve source attribution, the available source record identifiers, the issue or exclusion reason, and the retained source evidence reference. Unverified identity matches SHALL remain explicitly unverified. Annotation creation SHALL NOT fabricate a missing record or relationship.

#### Scenario: Employment omitted because its agency cannot be identified

- **WHEN** a POST source employment row cannot produce an AgencyPersonnel record because its agency is missing
- **THEN** the licensing authority SHALL receive an annotation identifying the source row or group of rows and the missing-agency issue
- **AND** the original source evidence SHALL remain inspectable
- **AND** no employment relationship SHALL be invented to create an annotation owner

#### Scenario: Explicitly excluded personnel and dependent records

- **WHEN** an operator excludes a POST source personnel record with a recorded reason
- **THEN** the licensing authority SHALL retain an annotation with that source identifier and reason
- **AND** any dependent omissions SHALL remain traceable to the exclusion that caused them
- **AND** a suggested but unverified identity match SHALL NOT be represented as an established identity

#### Scenario: Source issues change on rerun

- **WHEN** the same POST source is successfully reprocessed
- **THEN** its authority annotations SHALL reflect the current issues without accumulating duplicate findings
- **AND** annotations contributed by other sources SHALL remain intact

### Requirement: Preserve and validate multiple contact email addresses

Intake SHALL accept a semicolon-separated list of email addresses wherever source email fields are inspected. Every trimmed member MUST be a valid email address; an empty or invalid member SHALL retain the existing invalid-email annotation. The original source value SHALL remain intact. Separate source name and email fields MUST NOT be interpreted as verified name/address pairs.

#### Scenario: Multiple valid addresses in one source field

- **WHEN** an agency reports `office@example.org; records@example.org`
- **THEN** intake retains the source value without an invalid-email annotation

#### Scenario: A list contains an invalid member

- **WHEN** an email field contains `office@example.org; not-an-email`
- **THEN** intake retains the complete value and emits an invalid-email annotation

### Requirement: Native annotation records

Annotations SHALL be ordinary DataAnnotation records in public.data_annotation, emitted in DataAnnotations Artifacts and imported through the shared registry, facade, canonical source-name identity ledger, and normal generate/up pipeline. Manual and source producers SHALL use the same canonical IO and record contract. No refresh command or post-apply scan is permitted.

Each annotation SHALL contain a canonical id, polymorphic subject_kind and subject_id, producer_namespace and producer_record_id, source_namespace and source_record_id, type, field, original value, message, optional replacement_value and evidence, and status active or resolved. Root-generated records SHALL use producer namespace intake. Generation SHALL resolve obsolete findings only within its own producer and source contribution. Other producer findings SHALL remain intact. Raw evidence SHALL remain inspectable.

#### Scenario: Native manual and generated findings coexist

- **WHEN** manual, source, and root-generated annotations target the same record
- **THEN** each is imported through the ordinary facade and ledger with independent stable identity
- **AND** generation resolves only obsolete intake-produced findings.

#### Scenario: Replay applies an already generated plan

- **WHEN** up or replay applies annotation mutations
- **THEN** it only executes the ordinary mutation instructions without reinspection or annotation-specific writes.

#### Scenario: Partial update leaves a corrected field untouched

- **WHEN** a partial source update does not supply a previously corrected field
- **THEN** the existing correction annotation SHALL remain active
- **AND** explicit processing of that field without an applied correction SHALL resolve the obsolete generated correction.

#### Scenario: Correction explicitly replaces a value with null

- **WHEN** a full correction record or a transition to correction is supplied
- **THEN** replacement_value SHALL be explicitly provided, with null accepted when intended
- **AND** omission SHALL fail rather than imply a replacement of null.

#### Scenario: A partial annotation update changes its subject

- **WHEN** PATCH supplies either subject_kind or subject_id
- **THEN** generation SHALL validate the effective pair using the stored counterpart
- **AND** unknown kinds or nonexistent subjects SHALL fail visibly before mutation emission.
