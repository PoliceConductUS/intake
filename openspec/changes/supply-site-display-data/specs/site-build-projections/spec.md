## ADDED Requirements

### Requirement: Build projections are database relations

`location_path_closure` SHALL be a recursive view over `location_path.parent_location_path_id`. `agency_zip_index` SHALL be a view returning the first five characters of `agency.zip_code` for `site_agency_page` agencies with a ZIP. `build_page_payload` SHALL be a materialized view with the columns `path`, `page_type`, `entity_id`, `payload`, `content_hash`, `content_updated_at` and `generated_at`, built from the page-selection and count views. No website script SHALL write these relations.

#### Scenario: Website script attempts a write

- **WHEN** a client inserts into `build_page_payload`
- **THEN** the database rejects the write

### Requirement: One function refreshes and checks the projections

`public.refresh_site_projections()` SHALL refresh every materialized view in dependency order and SHALL then raise an error on an agency without a location path, a report without an agency, a location whose level or parent does not match its page, or a path claimed by two pages. `data up` SHALL NOT call it.

#### Scenario: Duplicate page path

- **WHEN** an agency page and a report page claim the same path
- **THEN** the refresh fails and names the path

### Requirement: Location map positions come from stored geometry

Place, area and state payloads SHALL take their map point and bounds from `location_path.centroid` and `location_path.bbox`. A location without them SHALL have no map point. An agency's map point SHALL be the agency's own coordinates.

#### Scenario: Place without a stored centroid

- **WHEN** a place row has a null `centroid`
- **THEN** its payload has no map point and no average of agency coordinates is used
