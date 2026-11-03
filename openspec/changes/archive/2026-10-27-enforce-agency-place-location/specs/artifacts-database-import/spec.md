## ADDED Requirements

### Requirement: Agency location resolution accepts only places

Every agency location path resolver MUST return only an ID referencing an existing location path with `level: place`. Supplied IDs, cached results, point containment, and postal rules MUST obey the same requirement. A non-place result MUST fail before it is assigned or cached as an agency location.

#### Scenario: Reject a non-place location

- **WHEN** an agency location candidate references a state or administrative-area row
- **THEN** resolution fails with the agency ID, location path ID, and invalid level
- **AND** the resolver does not return or cache the invalid ID

#### Scenario: Accept an existing place

- **WHEN** the candidate references an existing place row
- **THEN** the resolver returns that place ID

#### Scenario: Manual cache updates and reads validate the referenced type

- **WHEN** an agency location-path cache entry is read or written through canonical IO, including a manual update
- **THEN** the referenced location MUST be verified as an existing place
- **AND** missing validation capability or a non-place reference fails before returning or persisting the value

#### Scenario: Database enforces place-only references

- **WHEN** an agency is inserted or its location path changes
- **THEN** the database MUST reject any location path whose level is not place
- **AND** a referenced place MUST NOT be reclassified to another level

#### Scenario: Database-generated place level is not intake input

- **WHEN** intake generates writable record schemas, mutation contracts, foreign-key resolution metadata, or provider data requests
- **THEN** it MUST exclude database-generated columns, including `agency.location_path_level`
- **AND** intake MUST NOT set or update that field; PostgreSQL generates `place`
- **AND** enforcement-only uniqueness that includes the primary key MUST NOT become an intake business key
