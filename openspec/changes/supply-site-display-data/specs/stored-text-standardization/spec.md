## ADDED Requirements

### Requirement: Standard values are manual records

Intake SHALL keep standard values as manual records of kind `StandardValue`, each with a subject kind, a field, an exact `source_value`, a `standard_value` and a reason. No code SHALL embed a standard value or special-case a namespace, kind or source ID.

#### Scenario: Agency status entry

- **WHEN** an entry maps `Agency` field `status` from `ACTIVE` to `Active`
- **THEN** that entry exists only as a manual record

### Requirement: Standardization runs in data generate and records a correction

A shared stage in `data generate` SHALL apply standard values after property corrections and before validation. For each changed value it SHALL add a correction finding with message code `standardized_text`, which the shared import SHALL store as a correction annotation holding the original and the replacement value. Raw inputs and `data_source_values` SHALL keep the original value. `data up` SHALL only apply the recorded result.

#### Scenario: All-caps agency name

- **WHEN** an agency name is `EL PASO COUNTY CRIMINAL COURT AT LAW 2` and an entry maps it to `El Paso County Criminal Court at Law 2`
- **THEN** `agency.name` holds the standard value and a correction annotation holds both values

#### Scenario: Repeat generation

- **WHEN** the same inputs and entries are generated again
- **THEN** no mutation is produced and the annotation keeps its ID

### Requirement: Enumerated columns fail on unknown values

For `license.status`, `license_action.status` and `agency.status`, a value with no standard-value entry and not already a standard value SHALL fail generation, naming the value and the record.

#### Scenario: New license status text

- **WHEN** a license arrives with status `PROBATIONARY` and no entry holds it
- **THEN** generation fails naming `PROBATIONARY`

### Requirement: The corrections queue is covered

Standard values SHALL cover every column in the corrections queue: `license.status`, `license_action.status`, `authority_license.name`, `agency.status`, `agency.name`, `location_path.display_name`, `agency.contact_name`, `agency.state`, `civil_cases.outcome`, `agency_personnel.title`, `personnel.first_name`, `personnel.last_name` and `agency_phone_numbers.description`. Free-text entries SHALL be written per exact value after review; no automatic title-case rule SHALL run in the pipeline.

#### Scenario: Leading and trailing spaces

- **WHEN** an `agency_personnel.title` is `Sergeant` and an entry maps it to `Sergeant`
- **THEN** the title is stored as `Sergeant` with a correction annotation
