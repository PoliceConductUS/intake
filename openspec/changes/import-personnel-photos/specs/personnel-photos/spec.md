## ADDED Requirements

### Requirement: Import local personnel portraits

Intake SHALL store a local image in its workspace and attach it to an exact existing personnel through the shared canonical import and mutation chain, retaining file provenance, hash, byte size and content type. Imported photo IDs SHALL use the source-name mapping ledger.

#### Scenario: Local portrait import

- **WHEN** a user supplies an existing personnel ID and supported local image
- **THEN** intake stores the image and emits a typed PersonnelPhoto record for shared pipeline import

#### Scenario: Invalid person or image

- **WHEN** the exact personnel is missing or bytes are unsupported
- **THEN** import fails without a database association

### Requirement: Database-associated portrait rendering

The website SHALL use the personnel_photo association to stage and render verified workspace bytes.

#### Scenario: Associated photo exists

- **WHEN** an associated portrait exists
- **THEN** the website renders its copied asset and includes that image in structured data

#### Scenario: Associated bytes are missing or corrupt

- **WHEN** the database references missing or mismatched bytes
- **THEN** the website fails loudly
