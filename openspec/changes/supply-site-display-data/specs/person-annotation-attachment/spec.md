## ADDED Requirements

### Requirement: Annotations about a person attach to the person

For every annotation whose subject connects a person (`Personnel`, or a kind whose row links one person, such as `AgencyPersonnel`, `LicenseAction` or `CivilCasePersonnel`), intake SHALL set `data_annotation.personnel_id` to that person and SHALL keep `subject_kind` and `subject_id` on the record the finding is about (owner, 2026-11-22).

#### Scenario: License action annotation

- **WHEN** a TCOLE producer reports an annotation on a `LicenseAction` row of one officer
- **THEN** the `data_annotation` row keeps `subject_kind` `LicenseAction` and that row's `subject_id`, holds the officer in `personnel_id`, and links the officer and the TCOLE licensing authority

#### Scenario: Annotation about an agency

- **WHEN** an annotation has subject kind `Agency`
- **THEN** intake sets `agency_id` and no `personnel_id`

### Requirement: The person's page shows annotations about the person

The personnel page SHALL show every active annotation whose `personnel_id` names that person, through `site_annotation.page_path`. When the person has no personnel page, the annotation SHALL still appear on the full annotations list. This rule holds until data sources become first-class entities.

#### Scenario: Person without a page

- **WHEN** an annotation names a person who has no `agency_personnel` row
- **THEN** its `site_annotation` row has a null `page_path` and appears on the full annotations list
