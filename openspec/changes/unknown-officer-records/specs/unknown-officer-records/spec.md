## ADDED Requirements

### Requirement: Records with a known agency are kept when the officer is unknown

Intake SHALL store an arrest, report or civil case whose source names the agency but no identified officer, and SHALL link it to that agency. Intake SHALL NOT drop the record because the officer is unknown.

#### Scenario: Arrest with a blank officer name

- **WHEN** an Irving booking has no officer name
- **THEN** the arrest is stored and linked to the Irving agency

### Requirement: The unknown officer is recorded as a defect

Each such record SHALL carry an annotation saying the officer is not identified, with a message code from `data_annotation_message`.

#### Scenario: Report with no identified officer

- **WHEN** a report names Irving PD and no officer
- **THEN** the report carries an annotation saying the officer is not identified

### Requirement: An unknown officer is never staff

No staff count, personnel page, personnel listing, search entry or agency inclusion rule SHALL count or show an unknown officer as a person.

#### Scenario: Agency staff count

- **WHEN** an agency has 10 current officers and 50 arrests with no identified officer
- **THEN** its current staff count is 10

### Requirement: A database view presents unknown-officer records

A database view SHALL return, per agency, the records that have a known agency and no identified officer, so the site shows them without deciding which records they are.

#### Scenario: Agency page entry

- **WHEN** an agency has arrests with no identified officer
- **THEN** the view returns those arrests for that agency
