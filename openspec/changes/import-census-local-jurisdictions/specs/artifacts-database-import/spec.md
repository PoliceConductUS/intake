## ADDED Requirements

### Requirement: Census local jurisdictions are website places

The Census namespace SHALL import PLACE features, legal and nonfunctioning local county subdivisions, and consolidated cities within the existing 50 states and District of Columbia coverage. It SHALL exclude statistical subdivisions (S2, S3, Z5), undefined areas (Z9), and unorganized statistical territories (Z3). C2/C5/C7/T5/Z7 representations already covered by PLACE polygons SHALL not create duplicates. Classification MUST use Census CLASSFP and boundary data, not guessed names. Unknown subdivision class codes MUST fail visibly.

#### Scenario: Alba township

- **WHEN** Minnesota COUSUB contains Alba township, GEOID 2706300604
- **THEN** intake emits a place under Jackson County with its Census polygon minus imported PLACE coverage and readable township name
- **AND** county parent comes from COUSUB STATEFP/COUNTYFP, not a name match

#### Scenario: Statistical divisions

- **WHEN** COUSUB contains a CCD, census subarea, undefined area, or unorganized statistical territory
- **THEN** it is excluded with an inspectable reason in the source transform report

#### Scenario: Fully covered subdivision

- **WHEN** one or more imported PLACE polygons fully cover a county subdivision
- **THEN** intake skips that subdivision and records the reason
- **AND** does not alias a whole subdivision to one constituent place

#### Scenario: Existing identity and distinct geography

- **WHEN** supplemental geographies are added
- **THEN** existing PLACE paths and source names remain unchanged
- **AND** a township and a same-named city with different extents remain distinct
- **AND** consolidated cities remain distinct from their balance geographies

#### Scenario: Incomplete source set

- **WHEN** COUSUB or required CONCITY files are missing for the PLACE states or have a different vintage
- **THEN** transformation fails with the missing role/state or vintage rather than producing incomplete coverage

### Requirement: Containing geography precedence

Address resolution MUST prefer a containing primary place (Census PLACE), then a containing county subdivision, then a containing consolidated city. It MUST select exactly one distinct canonical location in the first nonempty class, otherwise fail with ambiguity. Every candidate MUST contain the address point. No hard-coded ZIP or place exceptions may substitute for containment. Cached resolutions from the previous policy MUST be invalidated.

#### Scenario: City inside township

- **WHEN** an address is inside a city or CDP and a township
- **THEN** the city or CDP resolves the address

#### Scenario: Rural township address

- **WHEN** an address is outside every primary place but inside exactly one imported township
- **THEN** that township resolves the address

#### Scenario: Same-class ambiguity

- **WHEN** two primary places contain the point
- **THEN** resolution fails even if a township also contains it

#### Scenario: No containing location

- **WHEN** no imported place contains the point
- **THEN** resolution fails without statewide-name or nearest-place substitution

## MODIFIED Requirements

### Requirement: Durable Canonical ID Assignment

The artifacts import pipeline MUST resolve every supported source entity key to a canonical database ID before database writes, assigning new IDs with `@paralleldrive/cuid2` only through persisted mapping records.

#### Scenario: Source Artifacts do not contain canonical IDs

- **WHEN** a source module produces an `Artifacts` envelope
- **THEN** the Artifacts envelope uses canonical entity and field names derived from the current intake database schema
- **AND** source entity ID fields and source relationship fields contain source-local IDs or source-local references only
- **AND** it MUST NOT include canonical database ID values in source entity IDs or source relationship fields
- **AND** canonical IDs are resolved from environment-specific SourceNameToCanonicalId state during import
- **AND** the same source Artifacts can resolve to different canonical IDs in different workspaces only through those workspace mapping records

#### Scenario: Existing mapping record is reused

- **WHEN** a source entity has a mapping record with `canonicalId`
- **THEN** intake uses that `canonicalId` as the database row ID for the entity

#### Scenario: Missing mapping record gets canonical ID

- **WHEN** a supported source entity is missing a mapping record
- **THEN** intake creates an object mapping record for that source key and assigns `canonicalId` with `@paralleldrive/cuid2`

#### Scenario: New canonical mappings are persisted before database writes

- **WHEN** intake assigns any new canonical IDs during artifacts import
- **THEN** it persists the updated mapping file before writing any database rows

#### Scenario: Canonical mapping is missing

- **WHEN** a supported source entity mapping lacks `canonicalId` after canonical mapping resolution
- **THEN** intake fails after canonical mapping resolution and before transforming entities or writing database rows
- **AND** reports all incomplete canonical mapping records found in that validation pass instead of stopping at the first missing field

#### Scenario: Resolution fields are deferred until write-time

- **WHEN** an agency mapping record has `canonicalId` but the canonical agency record lacks `slug`, `locationPathId`, `latitude`, or `longitude`
- **THEN** intake does not fail canonical mapping validation only because those resolution fields are absent
- **AND** intake requires each absent resolution field only when the database write needs that field for an insert or update

#### Scenario: Dynamically resolvable agency fields are resolved when needed

- **WHEN** a database write needs a missing agency `slug` or `locationPathId`
- **THEN** intake attempts to resolve the missing value before failing the write
- **AND** persists any successfully resolved value to the canonical agency record
- **AND** logs the resolution outcome

#### Scenario: Entity preparation uses field-keyed resolvers

- **WHEN** intake prepares an entity for an Import
- **THEN** it calls a generic entity preparation path equivalent to `context.add(entityType, row)`
- **AND** the entity preparation path resolves missing fields through resolvers keyed by entity type and field
- **AND** the entity preparation path determines the command operation intent such as `create`, `update`, or `read` when the entity is added
- **AND** field groups such as agency `latitude` and `longitude` may share one resolver when the values come from the same source operation
- **AND** field resolution logs identify the entity type, row ID, missing fields, resolved fields, and failure reason when resolution fails

#### Scenario: Missing source location path is not created

- **WHEN** a database write needs an agency `locationPathId`
- **AND** no persisted `public.location_path_geometry` place boundary contains the resolved agency address point
- **THEN** intake fails during import preparation before database writes
- **AND** reports the agency source key, canonical ID, name, city, state, ZIP, and address point
- **AND** MUST NOT create `public.location_path` rows while resolving source agency records

#### Scenario: Agency location path is resolved from address point geometry

- **WHEN** intake resolves a missing agency `locationPathId`
- **THEN** intake resolves the agency address point from the agency address, city, state, and ZIP when coordinates are not already present
- **AND** resolves the `locationPathId` by finding the persisted `public.location_path_geometry` place boundary that contains that point
- **AND** fails during import preparation if no place geometry contains the point
- **AND** selects the first nonempty containing class in the order primary PLACE, county subdivision, consolidated city and fails if multiple distinct place geometries in that class contain the point
- **AND** MUST NOT resolve agency `locationPathId` by constructing a path from city, state, administrative area, label, slug, or alias text
- **AND** MUST NOT copy location path geometry, place centroid, administrative-area centroid, or state centroid into agency `latitude` or `longitude`

#### Scenario: Location path geometry is separate from agency address coordinates

- **WHEN** intake prepares or writes a `locationPath` command
- **THEN** any `centroid` or `bbox` on that command describes the location path record itself
- **AND** `centroid` MUST be a GeoJSON `Point`
- **AND** `bbox` MUST be a GeoJSON `Polygon`
- **AND** those values are distinct from agency address `latitude` and `longitude`
- **AND** intake preserves location path geometry fields when they are present
- **AND** shared envelopes MUST NOT expose top-level location path `latitude` or `longitude`
- **AND** replay maps location path `centroid` and `bbox` envelope values to PostGIS columns on `public.location_path`

#### Scenario: Agency address coordinates are resolved independently

- **WHEN** a new agency row has a valid `locationPathId`
- **AND** either `latitude` or `longitude` is missing
- **THEN** intake resolves the missing agency address coordinates from the agency address
- **AND** does not create or replace the agency location path only because address coordinates were missing

#### Scenario: Agency address geocoding normalizes mailing fragments

- **WHEN** an agency address contains both a physical street address and a `PO Box` or mailing-address fragment
- **THEN** intake geocodes the physical street address
- **AND** preserves the original source address in the agency row

#### Scenario: Agency address geocoding may retry unresolved street addresses

- **WHEN** the batch agency address geocoder does not resolve a physical street address
- **THEN** intake may retry the same physical street address with another address-point resolver
- **AND** any resolved `latitude` and `longitude` still represent the agency address point

#### Scenario: ZIP centroids are not agency address coordinates

- **WHEN** agency address geocoding cannot resolve a physical address point
- **THEN** intake MUST NOT write a ZIP centroid, city centroid, place centroid, county centroid, or state centroid to agency `latitude` or `longitude`
- **AND** intake fails the affected agency resolution with source key, canonical ID, name, original address, city, state, and ZIP details

#### Scenario: Location path commands require complete hierarchy fields

- **WHEN** intake prepares a `locationPath` command
- **THEN** zod validation requires state paths to have no parent, administrative-area paths to include an administrative-area slug/name and state parent ID, and place paths to include administrative-area slug/name, place slug/name, and administrative-area parent ID
- **AND** intake fails during import preparation before database writes if a prepared location path is missing required hierarchy fields

#### Scenario: Prepared location path rows are unique by path

- **WHEN** multiple prepared `locationPath` commands have the same `path`
- **AND** those commands use different `location_path_id` values
- **THEN** intake fails during import preparation before database writes

#### Scenario: Cached agency location path is validated before use

- **WHEN** a new agency row has a non-empty cached canonical `locationPathId`
- **AND** the database does not contain that `public.location_path` row
- **THEN** intake fails during import preparation before resolving a replacement location path
- **AND** intake reports the missing cached canonical `locationPathId`
