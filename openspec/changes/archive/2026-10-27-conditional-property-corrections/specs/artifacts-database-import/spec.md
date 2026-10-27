## ADDED Requirements

### Requirement: Conditional source-property corrections

The cache CLI SHALL accept every declared entity property and an optional `--from` value. A conditional correction SHALL apply only when the typed input equals that value; without it a correction SHALL fill absent/null values, not empty strings. Source-addressed corrections SHALL survive resets without requiring an existing canonical mapping. Unknown properties and invalid values SHALL fail. Replacement SHALL require `--force`, retain previous entries, and record command ID and timestamp. Existing resolved caches SHALL remain available.

#### Scenario: Correct a present source value

- **WHEN** a source property equals the persisted `--from` value
- **THEN** its replacement is used before dependent generation
- **AND** a changed input no longer matches that correction
- **AND** raw acquired files remain unchanged

#### Scenario: Fill missing input

- **WHEN** an input property is absent or null and a default correction exists
- **THEN** the supplied value is used
- **AND** a present value, including an empty string, is not replaced

### Requirement: Distinct Census place identities and boundaries

Distinct Census GEOIDs SHALL remain separate place records and geometries. Property corrections SHALL apply during generation only; transforms SHALL NOT load corrections or receive a correction hook. Path collisions SHALL fail with the colliding GEOIDs and labels instead of merging, discarding or automatically renaming records. Existing common names remain the default.

#### Scenario: Correct a colliding place name

- **WHEN** two distinct GEOIDs have the same common name and county
- **THEN** transform emits separate records keyed by geography type plus GEOID
- **AND** generation applies the shared name corrections before deriving paths
- **AND** unresolved path collisions fail with both source identities
- **AND** no records or boundaries are merged to hide the collision

#### Scenario: One active rule and explicit precedence

- **WHEN** either form of cache set replaces an existing rule with force
- **THEN** the old entry is archived, never evaluated, and the new rule is the only active manual rule for that source property
- **AND** a match supplies its value before dependent resolution without chaining
- **AND** a nonmatch resumes normal source, matching automatic cache, and resolver behavior
- **AND** a replaced old canonical manual override is retired rather than acting as an unconditional fallback
- **AND** normal durable identity and slug ownership conflicts still fail loudly

#### Scenario: Transform does not receive property corrections

- **WHEN** a source transform runs
- **THEN** its dependencies contain no property-correction hook
- **AND** existing workspace corrections remain unchanged for generation

#### Scenario: Stable source keys and existing canonical identities

- **WHEN** a Census name or generated path changes
- **THEN** the source key remains geography type plus GEOID
- **AND** parent and boundary references use those same source keys
- **AND** alternate-county aliases use the place and county source keys and derive their paths from the corrected place name
- **AND** an explicit workspace mapping migration preserves the existing canonical IDs without a runtime compatibility path

#### Scenario: Corrected references and conflicting URL ownership

- **WHEN** a property correction replaces a source reference
- **THEN** the ordinary reference resolver resolves it to the canonical target ID
- **AND** URLs derived from that reference use the same resolved target
- **WHEN** two different locations claim a URL through canonical paths or alternate-county aliases
- **THEN** generation fails before any alias target can be silently discarded
