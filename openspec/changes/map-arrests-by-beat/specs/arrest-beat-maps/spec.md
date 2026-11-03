## ADDED Requirements

### Requirement: Official beat boundaries

Agency arrest profiles SHALL include official patrol beat codes, names, and Polygon or MultiPolygon boundaries in `breakdowns.arrest_beat_boundaries`. Source provenance SHALL remain attached. Missing or duplicate beat identities and matched codes without a boundary SHALL fail visibly. These are source-local identities scoped to the owning agency.

#### Scenario: Public evidence

- **WHEN** acquired official polygons are transformed
- **THEN** agency profiles include only patrol code, name, and geometry, without booking identifiers, personal addresses, or exact arrest points

### Requirement: Named count maps

Personnel and agency pages SHALL display patrol polygons labeled with beat name and arrest count. Each map SHALL provide its recorded period and counts not mapped to a patrol beat. Counts and labels SHALL remain available without JavaScript. Maps SHALL not imply that supplied boundaries were historically effective throughout the arrest period.

#### Scenario: Missing location

- **WHEN** an arrest cannot be assigned to a patrol beat
- **THEN** it remains in the total and is reported as not mapped to a patrol beat

### Requirement: Agency totals and scope

Agency maps SHALL use the agency booking aggregate once, never the sum of personnel profiles. Maps SHALL appear only on personnel and agency pages. Geographic rollups SHALL remain deferred.

#### Scenario: Multi-person booking

- **WHEN** multiple personnel are linked to a booking
- **THEN** the agency map counts that booking once using the agency aggregate

#### Scenario: Geographic page

- **WHEN** a visitor opens a city, county, state, or federal index page
- **THEN** this change does not add an arrest beat map
