## ADDED Requirements

### Requirement: POST assignments use their source-provided identity

MN POST SHALL join each roster contact and agency to activeEmployment entries in
that contact's acquired detail data and emit each distinct rosterId as the
AgencyPersonnel source name. Distinct Primary and Secondary entries at the same
agency SHALL remain distinct. A roster assignment without a matching nonblank
rosterId SHALL fail with the contact and agency identified, rather than generate
a replacement identity. The existing role and date interpretation SHALL remain.

#### Scenario: Existing POST assignment retains its canonical ID

- **WHEN** acquired activeEmployment identifies an assignment by rosterId and the
  durable ledger already maps that rosterId
- **THEN** the assignment resolves to the existing canonical ID
- **AND** discipline and coverage references target the rosterId

#### Scenario: Two POST assignments at one agency

- **WHEN** a contact has distinct Primary and Secondary rosterIds at the same agency
- **THEN** both assignments are emitted without collapsing them
- **AND** applicable discipline and coverage links reference each assignment

#### Scenario: No source assignment identity is available

- **WHEN** the acquired details lack a matching rosterId for an emitted roster assignment
- **THEN** transform fails identifying the contact and agency
- **AND** no person-and-agency replacement key is invented

### Requirement: TCOLE synthetic assignment keys normalize text whitespace

TCOLE SHALL trim APPOINTMENT and LICENSE when constructing assignment source
keys and replace runs of whitespace in these components with a single space.
Real source identifiers and raw acquired records SHALL NOT have their internal
whitespace rewritten. License-reference behavior SHALL remain unchanged.

#### Scenario: Repeated spaces reuse the original assignment mapping

- **WHEN** the source license text is `Telecommunications  Operator` and the
  durable ledger maps the corresponding single-space service tuple
- **THEN** the transform emits the single-space tuple
- **AND** ledger resolution returns the original canonical ID

### Requirement: Preserve unchanged attribution identities

MN discipline and coverage source names SHALL retain their existing agency-based
keys for a single assignment per agency. Where multiple rosterIds require
multiple attributions, source names SHALL distinguish them by rosterId.

#### Scenario: Assignment rekey does not rekey existing single-assignment links

- **WHEN** an existing attribution has exactly one matching assignment at its agency
- **THEN** its source name remains unchanged and its assignment reference uses rosterId

### Requirement: Shared structured-text whitespace resolution

All sources SHALL use the same whitespace normalization for structured text
properties through the shared resolver registry: names and name parts, titles,
addresses and cities, display names, abbreviations, source names, phone numbers,
status labels, courts, and action labels. Normalize surrounding and repeated
whitespace while preserving casing unless the field already has a casing resolver.
Absent values and explicit nulls SHALL remain distinct. Free-form narrative,
URLs, slugs, source identifiers, reference IDs, and JSON payloads SHALL NOT be
normalized by this resolver. No cache policy marker or global invalidation is
introduced. Source-generated text key components use the same pure function
before identity lookup.

#### Scenario: The same field normalizes across sources

- **WHEN** MN POST or TCOLE emits an assignment title with surrounding or repeated spaces
- **THEN** the shared field resolver returns a trimmed single-space title
- **AND** the original source value remains inspectable

#### Scenario: Narrative and identity values retain their meaning

- **WHEN** a case contains multiline narrative and a source-provided identity
- **THEN** those values retain their original whitespace
- **AND** only its configured structured text properties normalize

#### Scenario: A partial update does not clear omitted fields

- **WHEN** a configured text property is absent or explicitly null
- **THEN** resolution preserves undefined or null respectively
