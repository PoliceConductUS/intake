## ADDED Requirements

### Requirement: Report links reference civil-case identity

A report link to a civil case SHALL store the case foreign key instead of a copied URL or title. The existing link ID SHALL remain stable when converting a URL link to a case relationship. Intake SHALL use canonical envelopes and recorded mutations for the conversion.

#### Scenario: Convert the requested report link

- **WHEN** the Irving report link is converted to a case relationship
- **THEN** it retains its ID and references the existing case, with no copied URL or title

### Requirement: Case links render as internal navigation

The report SHALL load each related case title and slug from the referenced case and render `/civil-cases/{slug}/` without a new-tab target or external-link indicator.

#### Scenario: Render a related case

- **WHEN** the report is displayed
- **THEN** its case link uses the referenced case title and current slug and opens in the same tab

#### Scenario: Case title or slug changes

- **WHEN** the referenced case title or slug changes
- **THEN** the report uses the new title or slug without editing its stored relationship
