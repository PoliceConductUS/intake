## ADDED Requirements

### Requirement: Simplified format omits what the Institute controls

The Simplified Export Format SHALL describe only what a provider can send. It
SHALL NOT list a field that only the Institute fills in:
`ai_complaint_summary`, `complaint_summary_unavailability`, `confidence`,
`created_by`,
`data_source_values`, `normalized_url`, `source_exclusions`,
`source_namespaces`, or `updated_by`. It SHALL NOT list the
`AgencyArrestProfile`, `DataAnnotation`, or `PersonnelPhoto` record type. The
committed document MUST equal the output of its generator for the current
migrated schema.

#### Scenario: A table carries Institute-controlled columns

- **WHEN** the document is generated for a table that has any of the Institute-controlled fields
- **THEN** none of those fields appears in that record type's field table
- **AND** the table's provider-supplied fields still appear

#### Scenario: The schema has Institute-produced record types

- **WHEN** the document is generated for a schema containing `agency_arrest_profile`, `data_annotation`, and `personnel_photo`
- **THEN** the document has no `AgencyArrestProfile`, `DataAnnotation`, or `PersonnelPhoto` section

#### Scenario: The committed document is compared with its generator

- **WHEN** the generator runs against a database built from the migrations
- **THEN** its output equals the committed `docs/data-request-format.md`
