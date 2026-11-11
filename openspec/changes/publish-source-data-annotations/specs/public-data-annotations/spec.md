## ADDED Requirements

### Requirement: Show findings where reported data appears

The site SHALL show source-reported values and their annotations together on the affected public record display. It SHALL identify the source provider and source record ID and distinguish our warning/error/correction from the provider's reported data. Calculated tenure SHALL remain visible for parseable dates even when negative or unusually long. An unparseable annotated date SHALL display its original literal value without treating an empty typed end date as current employment.

#### Scenario: Negative tenure

- **WHEN** the supplied dates produce a duration of minus 12 days
- **THEN** the page SHALL show the supplied dates, reported duration of minus 12 days and the end-before-start error

#### Scenario: Long tenure

- **WHEN** the supplied dates produce 125 years
- **THEN** the page SHALL show 125 years with source attribution and the unusual-duration warning

### Requirement: One public annotation index

The generated site SHALL provide `/data-annotations/` with pagination and filters by source provider and annotation type. Each entry SHALL show the affected person or agency, field, original reported value, type, explanation, source provider, source record ID and a link to the affected record display. All pages SHALL use one build-time collection of persisted annotations. Filtering SHALL precede pagination and page links SHALL preserve filters.

#### Scenario: Filtered multi-page results

- **WHEN** a provider has more than one page of warnings
- **THEN** selecting that provider and warning type SHALL show only its warnings across all result pages
- **AND** every entry SHALL link to the public display containing the annotated data

### Requirement: Complete filtered CSV download

Every annotation listing SHALL offer a CSV download of all matching entries across all pages. CSV SHALL contain `source_provider,source_record_id,record_url,field,reported_value,type,message,replacement_value,evidence`. Correction entries SHALL include their replacement value and supplied evidence; those columns SHALL be empty for annotations without those values. Original values SHALL survive CSV serialization, including quotes, commas and newlines. Downloads SHALL be generated from the same data and filters as the listing without a runtime API.

#### Scenario: Download exceeds visible page

- **WHEN** a filtered listing contains 125 annotations and the visible page shows 50
- **THEN** its download SHALL contain all 125 matching annotations and the column header

### Requirement: Licensing authority annotation subpage

Each licensing-authority page SHALL link to a paginated annotations subpage listing findings originating from that authority's data. Source ownership SHALL use explicit source-to-authority metadata. The subpage SHALL share the central index's entries, type filtering and full-result CSV downloads. Membership SHALL NOT depend on a person's current employer or merely holding a license from that authority.

#### Scenario: Authority data spans record types

- **WHEN** an authority supplies personnel, employment and license records with annotations
- **THEN** its subpage SHALL include findings from all those records
- **AND** annotations contributed by unrelated providers SHALL not be attributed to that authority

#### Scenario: Authority without findings

- **WHEN** an authority has no annotations in the current build
- **THEN** its subpage SHALL display an empty result state and its CSV SHALL contain the header without fabricated entries

### Requirement: Publish applied correction provenance

Profiles, central and authority listings, type filters and CSV downloads SHALL include correction annotations alongside warnings and errors. Correction displays SHALL show original and replacement values, our explanation and evidence when supplied without attributing our override to the source provider. Multiple types on a field SHALL remain visible.

#### Scenario: Corrected address still has a warning

- **WHEN** an address has an applied correction and its effective value triggers a warning
- **THEN** the profile and listings SHALL show both entries and the download SHALL include both
- **AND** filtering to correction SHALL return its original value, replacement value, explanation and supplied evidence
