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

### Requirement: Geocoding failures identify the request

Geocoding failures SHALL report the HTTP method and Census endpoint, every
agency in the failed request (canonical ID, source name when available, agency
name, and address), and the underlying failure. Network errors SHALL retain
nested cause messages and connection error codes and details; HTTP errors SHALL
include the status, and timeouts SHALL include the configured duration. These
details SHALL survive conversion to the import and reset command error text.

#### Scenario: Census request fails during generation

- **WHEN** a batch or single-address geocoding request fails during generation
- **THEN** the error identifies the affected request and agencies rather than only reporting `fetch failed`
- **AND** the same request context accompanies a failure while reading its response

#### Scenario: An agency address has no usable coordinate result

- **WHEN** an agency has no reusable coordinate pair and address geocoding returns no usable coordinates
- **THEN** the error includes its canonical ID, source namespace and source ID, agency name, and full address
- **AND** it identifies latitude and longitude as the properties requiring verified physical-location coordinates, with concrete cache get/set command templates and overwrite instructions
- **AND** it explains that a location_path_id correction alone cannot resolve missing agency coordinates
- **AND** no existing cached coordinates are automatically accepted under a different policy

### Requirement: Cache-correctable failures expose command arguments

The shared entity property resolver SHALL attach cache get/set command templates
to failed live resolution of any cache-backed property whose value is not
supplied directly by the source. The templates SHALL include the source
namespace, exact entity kind, source ID, property, and a clearly marked value
placeholder, with shell-quoted arguments where needed. They SHALL retain the
original error and canonical ID, explain `--force` for existing cache entries,
and attribute dependency failures to the property that actually failed rather
than suggesting an override of its dependent property. Cache storage failures
and properties that cannot be corrected through the cache SHALL NOT be presented
as correctable by setting a value.

#### Scenario: A non-geocoding property fails resolution

- **WHEN** a cache-backed slug or location-path property fails live resolution
- **THEN** the error provides that record's cache command arguments through the shared resolver
- **AND** it does not require a special error formatter for each entity type

### Requirement: Concurrent address resolutions share a bounded Census queue

All callers of one import's Census coordinate resolver SHALL share a queue.
This SHALL reuse CurrentRowReader's coalescing mechanism through a shared
batch-loader, as specified in ADR 0016 decision 10. Geocoding loads SHALL be
memoized by normalized address, mapping results back to each caller's identity.
Pending addresses SHALL be combined into batches of at most 1,000 addresses.
Only one Census request SHALL run at a time, including single-address attempts
after a batch miss. Each caller SHALL receive only its own results. A failed
request SHALL reject pending work and stop that resolver from issuing further
requests, preserving the original request diagnostics. Cache behavior and
address-resolution rules remain unchanged.

#### Scenario: Thousands of agencies need coordinates concurrently

- **WHEN** 2,949 single-agency calls arrive before the queue starts
- **THEN** the resolver submits three batches of 1,000, 1,000, and 949 addresses
- **AND** requests do not overlap

#### Scenario: A Census request fails with work pending

- **WHEN** a batch or single-address request fails
- **THEN** all waiting callers receive the failure and no further requests start
