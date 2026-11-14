## ADDED Requirements

### Requirement: Oregon roster personnel do not require certificates

The Oregon source SHALL emit every roster person regardless of certificate presence, type, level or status. It SHALL retain available employment relationships and actual supplied credentials. Empty certificate data SHALL produce no fabricated licenses and SHALL NOT omit the person or supported employment relationships. Existing strict parsing, required-field validation and explicitly configured corrections/exclusions remain effective. Canonical IDs and stored slugs SHALL remain unchanged for returning identities.

#### Scenario: Empty certificate table

- **WHEN** a roster person has an explicit empty certificate table and supplied employment history
- **THEN** the person, agency and employment records remain while no license is invented

#### Scenario: Medical or instructor credentials

- **WHEN** a roster person has only medical dispatcher, maintenance or instructor credentials
- **THEN** the person and relationships remain with the actual supplied credentials
