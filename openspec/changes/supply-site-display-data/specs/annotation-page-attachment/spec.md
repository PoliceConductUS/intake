## ADDED Requirements

### Requirement: Annotations store the page they attach to

`data_annotation` SHALL have nullable foreign-key columns `agency_id`, `personnel_id`, `review_id`, `civil_case_id`, `location_path_id` and `federal_agency_id`, beside `licensing_authority_id`. A check SHALL require at least one. The producer SHALL supply them in the annotation envelope; `data up` SHALL store what the envelope holds. For a record kind, the producer SHALL set the column of the record whose page shows the annotation.

#### Scenario: Phone number annotation

- **WHEN** a producer reports an error on an `AgencyPhoneNumber` row
- **THEN** the annotation holds that row's agency in `agency_id`, and `site_annotation` shows it on that agency's page

#### Scenario: No attachment

- **WHEN** an annotation row has none of the attachment columns set
- **THEN** the database rejects the row

### Requirement: Annotations on a link between two records show only under the licensing authority

For an annotation whose subject is a link between two records (`CivilCasePersonnel`, `DisciplineAgencyPersonnel`, `CoverageLinkAgencyPersonnel`, `ReviewPersonnel`, `AgencyPersonnel` and any later link kind), intake SHALL set only `licensing_authority_id`. The annotation SHALL show on that authority's annotations list and the full annotations list, and on no record page (owner, 2026-11-22).

#### Scenario: Civil case link annotation

- **WHEN** a producer reports an annotation on a `CivilCasePersonnel` row
- **THEN** `site_annotation` has one row for it, on the licensing authority's annotations page, and none on the case page or the person's page

### Requirement: Shown values are stored for display

`data_annotation` SHALL have `display_value` and `display_replacement_value`, nullable plain text written by the producer and safe to show. The site SHALL show only these columns, and SHALL show no value when they are null. `value` and `replacement_value` SHALL stay as the audit record. For message codes `excluded_duplicate` and `excluded_record`, `display_value` SHALL hold the excluded record's name.

#### Scenario: Correction to a reference column

- **WHEN** a correction changes an agency's `location_path_id`
- **THEN** `display_value` and `display_replacement_value` hold the place names or are null, and no internal ID is shown

### Requirement: Annotation type labels are manual records

The manual-records table `data_annotation_type` SHALL hold each annotation `type` and its public `label`. `data_annotation.type` SHALL reference it. `site_annotation` SHALL return the label.

#### Scenario: Error label

- **WHEN** an annotation has type `error`
- **THEN** `site_annotation` returns the label stored for `error`, and the site holds no type-to-label map

### Requirement: One view gives every annotation its page

`site_annotation` SHALL be a materialized view with one row per active annotation and page it attaches to, holding `page_path` (null when the attached record has no page), record label and path, the message from `data_annotation_message`, the type label, field, `display_value`, `display_replacement_value`, evidence, `source_namespace` and `source_record_id`.

#### Scenario: Agency without a page

- **WHEN** an annotation is attached to an agency that has no `site_agency_page` row
- **THEN** its `site_annotation` row has a null `page_path` and still appears on the full annotations list
