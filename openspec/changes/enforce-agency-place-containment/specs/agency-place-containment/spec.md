## ADDED Requirements

### Requirement: Address-derived places follow spatial evidence

Agency location resolution SHALL use exactly one existing place boundary
containing the resolved address point. If no place contains the point, only the
postal-area exceptions explicitly listed in the accepted import specification
MAY supply an existing place. Otherwise preparation SHALL fail with source key,
canonical ID, name, address, city, state, ZIP, and point details. Multiple
containing places SHALL fail without applying a postal exception.

#### Scenario: Same name exists in another county

- **WHEN** Sam Rayburn ISD's point is in Fannin County and no Census place
- **AND** Ivanhoe exists as a place in Tyler County
- **THEN** resolution fails rather than choosing Ivanhoe, a nearest place, or a county

#### Scenario: An alias names a non-containing place

- **WHEN** no place contains the point and the county plus mailing city resolves through a path or alias
- **THEN** that textual match does not satisfy place containment

#### Scenario: Explicit postal exception

- **WHEN** no place contains a Saint Paul address point with Minnesota ZIP 55111
- **THEN** the existing Saint Paul place may resolve through the specified postal rule
- **AND** an administrative-area row cannot satisfy that exception

### Requirement: Previously inferred assignments do not bypass the corrected policy

The derived location cache fingerprint SHALL identify the containment policy
and all postal-rule inputs. A previous-policy cache entry or existing database
assignment SHALL NOT substitute for resolution on a cache miss. Only coordinate caches produced under the corrected address-point policy
SHALL remain reusable. Existing rows and old coordinate fingerprints SHALL NOT
bypass address-point resolution on a cache miss. Source-provided values and explicit manual seeds
retain their existing precedence under ADR 0019.

#### Scenario: Reprepare a previously snapped agency

- **WHEN** an agency has a cached or persisted inferred place from the old policy
- **THEN** preparation uses the corrected containment policy with the resolved coordinates
- **AND** an unresolved place fails instead of retaining the old inferred assignment

### Requirement: Coordinates represent the agency address

The coordinate resolver SHALL use address-point geocoding. It MAY retry the
same street address after a batch miss. It SHALL NOT substitute a city, place,
or ZIP-area centroid when the address does not resolve.

#### Scenario: Medina street address fails geocoding

- **WHEN** both address-point attempts fail for Medina ISD
- **THEN** the address remains unresolved and import preparation fails
- **AND** no same-name locality or ZIP centroid is requested or accepted
