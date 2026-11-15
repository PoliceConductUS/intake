## ADDED Requirements

### Requirement: Manually curated licensing authorities

The manual source MUST accept LicensingAuthority through its shared record schema and emit LicensingAuthorities through canonical artifact IO. State source references MUST resolve to existing state location rows and canonical IDs MUST come from the existing persisted identity mapping. Source names and websites MUST be verified against official sources with an audit manifest.

#### Scenario: Verified authority

- **WHEN** a valid authority is acquired with stable source ID and state code
- **THEN** transform emits the same name, website and state reference for normal import resolution

#### Scenario: Missing required state

- **WHEN** an authority lacks location_path_id
- **THEN** acquisition fails without adding a manual record
