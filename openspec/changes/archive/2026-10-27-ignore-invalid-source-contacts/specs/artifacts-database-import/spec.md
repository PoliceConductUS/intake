## ADDED Requirements

### Requirement: Invalid source contact values are omitted visibly

Intake SHALL apply manual cached corrections before validating phone numbers, email addresses and all URL fields, including evidence and link URLs for every source. All-zero phone numbers and clearly malformed contact values SHALL be omitted and logged as source data defects, identifying source namespace, record kind, source key, field, original value and reason. Invalid optional contacts SHALL NOT exclude the agency or other owning record. A record with an invalid required typed value SHALL emit no mutation; dependent records SHALL also be omitted with a source-defect log rather than written with missing references. Raw source artifacts SHALL remain intact, and these omissions SHALL NOT create persistent exclusions. Corrected valid source values SHALL be accepted on later runs.

#### Scenario: Corrected zero phone

- **WHEN** a source phone contains `(000) 000-0000` and a matching cached correction supplies a valid number
- **THEN** generation retains the phone record with the corrected number

#### Scenario: Uncorrected zero phone

- **WHEN** an AgencyPhoneNumber has an all-zero number without a valid cached correction
- **THEN** generation logs a source data defect and omits only that phone record

#### Scenario: Invalid optional contact

- **WHEN** an optional email or URL field is clearly malformed
- **THEN** generation logs the defect and omits that property while retaining its owner

#### Scenario: Invalid evidence URL

- **WHEN** a source supplies a malformed required evidence or link URL
- **THEN** generation logs the defect and omits that record and its dependent links, preserving independent agencies and personnel
