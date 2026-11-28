## ADDED Requirements

### Requirement: Annotations store the page they attach to

`data_annotation` SHALL have nullable foreign-key columns `personnel_id`, `agency_id`, `review_id`, `civil_case_id`, `location_path_id`, `federal_agency_id` and `licensing_authority_id`, with at most one set. Intake SHALL set one from the records the subject connects: a linked person, else a linked agency, else the record whose page shows it, else the licensing authority (owner, 2026-11-22).

#### Scenario: Link between a person and a civil case

- **WHEN** intake writes an annotation on a `CivilCasePersonnel` row
- **THEN** it sets `personnel_id` to the linked person, and `site_annotation` shows it on that person's page

#### Scenario: Phone number annotation

- **WHEN** intake writes an annotation on an `AgencyPhoneNumber` row
- **THEN** it sets `agency_id` to that row's agency

#### Scenario: License type annotation

- **WHEN** intake writes an annotation on an `AuthorityLicense` row
- **THEN** it sets only `licensing_authority_id`

#### Scenario: News coverage annotation

- **WHEN** intake writes an annotation on a `CoverageLink` row whose `coverage_link_agency_personnel` rows name two people
- **THEN** it sets `personnel_id` to the person of the row with the lowest `id`, and links each person and agency once

#### Scenario: News coverage without linked people

- **WHEN** intake writes an annotation on a `CoverageLink` row with no `coverage_link_agency_personnel` rows
- **THEN** generation fails and says the annotation has no page attachment

#### Scenario: Subject kind without a rule

- **WHEN** intake writes an annotation on a subject kind with no attachment rule
- **THEN** generation fails and names the kind

#### Scenario: Two attachments

- **WHEN** an annotation row sets both `personnel_id` and `agency_id`
- **THEN** the database rejects the row

### Requirement: Annotations store human-readable links

`data_annotation.links` SHALL be a non-empty JSON array of `{"url", "label"}`, one per connected record in display order, built by intake from stored canonical paths and slugs. A url SHALL be a site path with an optional `#fragment`, or null for a record without a page; a database check SHALL reject any other shape. Intake SHALL derive the links on every generation.

#### Scenario: Assignment annotation

- **WHEN** intake writes an annotation on Pat One's assignment at Agency A
- **THEN** its links are `/personnel/pat-one/#agency-assignments` labelled `Pat One` and Agency A's page path labelled `Agency A`

#### Scenario: Link that is not JSON url and label

- **WHEN** a row's links hold an object with an `id` key, or a url that starts with `https://`
- **THEN** the database rejects the row

#### Scenario: Linked agency without a page

- **WHEN** a stored link names an agency path that is not a `site_page` path at refresh time
- **THEN** `site_annotation` returns that link with a null url and its label

### Requirement: Shown values are stored for display

`data_annotation` SHALL have `display_value` and `display_replacement_value`, nullable plain text written by intake and safe to show; the site SHALL show only these, and nothing when they are null. `value` and `replacement_value` SHALL stay the audit record. An internal reference field (`id`, or `*_id` other than `source_*`) and a JSON null SHALL have no shown value.

#### Scenario: Correction to a reference column

- **WHEN** a correction changes an agency's `location_path_id`
- **THEN** `display_value` and `display_replacement_value` are null, and no internal ID is shown

#### Scenario: Excluded record

- **WHEN** an annotation on field `excluded_records` holds an excluded record named `Old Agency`
- **THEN** its `display_value` is `Old Agency`

### Requirement: Annotation type labels are manual records

The manual-records table `data_annotation_type` SHALL hold each annotation `type` and its public `label`. `data_annotation.type` SHALL reference it once the records exist. `site_annotation` SHALL return the label.

#### Scenario: Error label

- **WHEN** an annotation has type `error`
- **THEN** `site_annotation` returns the label stored for `error` (`Data error`, owner 2026-11-22), and the site holds no type-to-label map

### Requirement: One view gives every annotation its page

`site_annotation` SHALL be a materialized view with one row per active annotation, holding `page_path` (null when the attached record has no page), the page type, the licensing authority's page path when attached to one, the type and type label, the message, the links, `display_value`, `display_replacement_value`, `source_namespace` and `source_record_id`. It SHALL hold no field name, evidence or internal ID column.

#### Scenario: Agency without a page

- **WHEN** an annotation is attached to an agency that has no `site_agency_page` row
- **THEN** its `site_annotation` row has a null `page_path` and still appears on the full annotations list
