## ADDED Requirements

### Requirement: Manage manual resolved-property values through the CLI

The CLI SHALL provide `cache get` and `cache set` addressed by source namespace, entity kind, source ID, and property. It SHALL resolve canonical identity from the durable ledger without minting an ID. Set SHALL validate the value against the canonical property schema and reject non-resolved properties and identity fields. Manual overrides SHALL be read before automatically fingerprinted cache entries, retain prior entries and replacement history, and record source provenance through canonical ResolvedProperty IO.

#### Scenario: Inspect an existing cache

- **WHEN** an operator runs `cache get` for an existing source identity
- **THEN** the command displays the canonical identity, target property, entries, including the active override and stored automatic/previous values

#### Scenario: Refuse an unforced overwrite

- **WHEN** an operator runs `cache set` and any cached value already exists
- **THEN** the command returns a nonzero status, displays existing values, and leaves the cache unchanged

#### Scenario: Force a manual correction

- **WHEN** an operator supplies `--force`
- **THEN** set records the validated override and source identity, retaining previous values for audit
- **AND** subsequent cache reads use the override regardless of the automatic resolver input fingerprint

#### Scenario: One entries collection for all cached values

- **WHEN** a ResolvedProperty is read or written
- **THEN** all values are stored in required `spec.entries`; `spec.override`, `spec.overrideHistory`, and top-level `spec.value` are rejected
- **AND** at most one entry has no `inputFingerprint`; that entry is the active override and takes precedence over fingerprinted entries without being rewritten on reads
- **AND** without an override, only the matching fingerprint is returned

#### Scenario: Replace an override

- **WHEN** a valid forced cache set replaces an existing override
- **THEN** the old entry receives a unique `previous-override-N` fingerprint while retaining its value and provenance
- **AND** the new entry has no fingerprint and records `recordedAt`, source identity, and the ID of the canonical Command envelope for this cache-set invocation
- **AND** all automatic entries remain intact

#### Scenario: Convert existing cache state

- **WHEN** existing supported cache files and checked-in cache seeds are converted to the entries-only format
- **THEN** values, source evidence, metadata, and known original timestamps are retained
- **AND** unknown historical command IDs are not invented

#### Scenario: Invalid identity or value

- **WHEN** a source identity is unmapped, or the kind, property, or value is invalid
- **THEN** the command fails without modifying cache state or assigning an identity

#### Scenario: Wrong value type

- **WHEN** an operator supplies a nonnumeric value such as `fred` for latitude or longitude
- **THEN** the command reports `Value must be a number.` and leaves the cache unchanged
- **AND** type errors name the expected type from the canonical property schema instead of listing unrelated JSON types

### Requirement: Load manual communities before agency resolution during reset

Reset SHALL apply manual LocationPath and LocationPathAlias records after Census locations and before dependent agency imports. The complete manual source SHALL still run after automatic sources to apply records that depend on agencies and personnel. The confirmed 29 missing Texas community records SHALL retain their published paths and original canonical IDs. No artificial boundaries or inferred agency assignments SHALL be created.

#### Scenario: An agency references a manually resolved community

- **WHEN** an agency's location cache explicitly names a manual community
- **THEN** that community exists before the agency's mutations are applied during reset

#### Scenario: A manual community has no boundary

- **WHEN** only a manual place record is present
- **THEN** address resolution does not invent containment; an explicit assignment is still required where Census resolution fails
