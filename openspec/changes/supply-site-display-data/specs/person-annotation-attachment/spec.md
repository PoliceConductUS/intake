## ADDED Requirements

### Requirement: Annotations about a person attach to the licensing authority

For every annotation whose subject is a person, intake SHALL store `data_annotation.licensing_authority_id`, supplied by the producer in the annotation envelope, and SHALL keep `subject_kind` and `subject_id` on the person record. A subject is a person when `subject_kind` is `Personnel` or a kind whose row one person owns, such as `AgencyPersonnel`, `AuthorityLicense` or `LicenseAction`.

#### Scenario: License action annotation

- **WHEN** a TCOLE producer reports an annotation on a `LicenseAction` row of one officer
- **THEN** the `data_annotation` row keeps `subject_kind` `LicenseAction` and that row's `subject_id`, and holds the TCOLE licensing authority's ID in `licensing_authority_id`

#### Scenario: Missing authority

- **WHEN** an annotation has subject kind `Personnel` and no `licensing_authority_id`
- **THEN** the database rejects the row

#### Scenario: Annotation about an agency

- **WHEN** an annotation has subject kind `Agency`
- **THEN** `licensing_authority_id` is not required

### Requirement: Authority and person pages show annotations about a person

The licensing-authority page SHALL show every annotation whose `licensing_authority_id` names that authority. The person's page SHALL show the annotation through `subject_kind` and `subject_id` once that page is built. This rule holds until data sources become first-class entities.

#### Scenario: Person page not built yet

- **WHEN** an annotation about an officer holds a licensing authority and the officer's page is not built
- **THEN** the annotation still appears on the licensing-authority page
