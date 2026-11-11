## ADDED Requirements

### Requirement: Preserve reported values with record-owned annotations

Intake SHALL import identifiable source records despite factual data defects and persist `data_annotations` on the affected record. Each annotation SHALL contain `field`, `value` (the inspected effective value for warnings/errors or original source value for corrections), `type`, `message`, `source_namespace`, and `source_record_id`. The canonical shared schema SHALL initially permit exactly `warning`, `error`, and `correction` as types. Annotations SHALL use the owner's identity without separate IDs or a separate annotation table. Raw provenance SHALL remain intact. Structural failures in envelopes, identity, references or writes SHALL still fail visibly.

#### Scenario: Reversed employment dates

- **WHEN** TCOLE supplies start 2024-06-03 and end 2024-05-22
- **THEN** both dates and the assignment SHALL be imported and the post-mutation scan SHALL attach an error on end_date stating that it precedes start_date
- **AND** the factual defect SHALL NOT remove the person or dependent records

#### Scenario: Value cannot fit its typed column

- **WHEN** a source date is the literal string "not a date"
- **THEN** the annotation SHALL preserve that exact string, identify the source record and explain the invalid value
- **AND** the affected descriptive typed field SHALL be empty without discarding its owner or asserting current employment

### Requirement: Distinguish errors from warnings

Demonstrable contradictions and invalid values SHALL be errors. Unusual but unproven facts SHALL be warnings. Existing duration thresholds SHALL trigger warnings rather than invalidity or omission. A future reported date SHALL remain visible with a warning rather than suppressing a scheduled record. Annotation wording SHALL distinguish our assessment from the provider's reported facts.

#### Scenario: Unusually long employment

- **WHEN** reported dates yield 125 years of employment
- **THEN** intake SHALL retain the dates and the post-mutation scan SHALL attach a warning describing the unusually long reported duration
- **AND** the warning SHALL NOT claim the duration is false merely because it exceeds the existing threshold

#### Scenario: Scheduled future employment

- **WHEN** the source reports an employment start after the validation day
- **THEN** the assignment SHALL remain available for import with its reported future date and a warning

### Requirement: Recalculate annotations after all mutations succeed

The mutation command SHALL execute one explicit annotation stage after the complete pending mutation batch succeeds. It SHALL inspect final database values and persisted source evidence, recompute only warnings/errors from final effective values after corrections, and atomically replace that portion of stored annotation arrays. It SHALL clear obsolete warnings/errors and preserve all correction annotations applied by mutations. It SHALL NOT inspect transient states between individual mutations or clear prior findings before the scan succeeds. The stage SHALL run even when no mutations are pending, so time-dependent findings can change. The same input and validation day SHALL produce the same findings. Canonical IDs and slugs SHALL remain stable.

#### Scenario: Later mutation resolves a contradiction

- **WHEN** an earlier mutation creates a conflicting date pair and a later mutation in the same successful batch corrects it
- **THEN** the scan SHALL evaluate the final corrected pair once and persist no obsolete date-pair error

#### Scenario: Corrected existing record

- **WHEN** final database values no longer trigger a previously stored finding
- **THEN** the post-mutation stage SHALL remove that finding and retain all findings still supported by final values and source evidence

#### Scenario: Mutation batch fails

- **WHEN** any mutation in the batch fails
- **THEN** the command SHALL fail without starting annotation recalculation or claiming refreshed annotations

#### Scenario: Annotation scan fails

- **WHEN** recalculation fails after mutations have succeeded
- **THEN** the command SHALL report the annotation stage failure and retain the prior warning/error set without partial replacement; correction annotations already applied with successful mutations SHALL remain
- **AND** rerunning with no pending mutations SHALL retry the annotation stage

#### Scenario: Validation day changes without new data

- **WHEN** a future employment date becomes current and a no-pending-mutations command runs
- **THEN** recalculation SHALL clear the obsolete future-date warning

### Requirement: Carry applied corrections in generated mutations

Generated mutations SHALL carry correction annotations for overrides actually applied during the current run, including when the effective value equals the existing database value. A correction SHALL retain the original value, replacement_value, explanation in message, source_namespace, source_record_id and supporting evidence when supplied. Merely configured or nonmatching overrides SHALL NOT produce a correction annotation. Annotation changes SHALL be compared and persisted even if other field values do not change.

#### Scenario: Correction yields the already-stored value

- **WHEN** an address correction applies and its result already equals the stored address
- **THEN** its correction annotation SHALL still be included in the source contribution for the run
- **AND** a changed annotation set SHALL be persisted without requiring an address value change

### Requirement: Replace correction contributions by record and source identity

Correction replacement SHALL be scoped by owning entity kind/canonical ID plus source_namespace plus source_record_id. Mutations SHALL explicitly identify each processed contribution and its complete correction set, including an empty set. Apply SHALL replace only correction annotations for that contribution, preserve all other contributions, and leave warning/error recalculation to the final scan. Unprocessed contributions SHALL survive. Multiple mutations for one contribution in a run SHALL retain the complete run contribution, not replace it with individual field subsets. Stored annotations SHALL be merged against current apply-time state rather than replacing another source's contributions from a stale generation snapshot.

#### Scenario: Two providers mutate one record

- **WHEN** sources A and B each produce corrections for the same canonical record
- **THEN** applying either source's contribution SHALL preserve the other source's correction annotations

#### Scenario: Two source IDs in the same namespace

- **WHEN** source records A1 and A2 in the same namespace contribute to one canonical record
- **THEN** replacing A1's correction set SHALL leave A2's set unchanged

#### Scenario: Processed source no longer applies corrections

- **WHEN** a source contribution is processed with no applied corrections
- **THEN** its explicit empty replacement SHALL clear only its previous correction annotations

#### Scenario: Untouched source contribution

- **WHEN** a record or source contribution is not processed during the run
- **THEN** its correction annotations SHALL survive, including during a no-pending-mutations validation scan

#### Scenario: Correction and warning coexist

- **WHEN** a correction applies but the resulting effective value still triggers a warning
- **THEN** the final scan SHALL retain the correction annotation and publish the warning for the resulting value
