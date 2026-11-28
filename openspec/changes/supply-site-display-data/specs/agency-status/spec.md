## MODIFIED Requirements

### Requirement: Agency retains optional source-reported status and date

Agency records SHALL support nullable text status and nullable date status_date. A supplied status SHALL be nonblank. Canonical artifacts and create/update contracts SHALL expose these fields. Sources that omit either field SHALL retain the existing absent-field update behavior. A known status SHALL NOT require a known status_date. A stored status SHALL be a standardized word from the standard-value manual records; the source text SHALL be kept in the correction annotation and in `data_source_values`.

#### Scenario: Status with unknown official date

- **WHEN** an agency has source status INACTIVE and no supplied status date
- **THEN** intake stores Inactive with a correction annotation holding INACTIVE, and null status_date

#### Scenario: Nullable fields on existing records

- **WHEN** the migration runs against existing agency rows
- **THEN** both new columns are null without changing other columns or record identities

### Requirement: TCOLE preserves reported agency status

TCOLE SHALL map STATUS to agency status and DATE_OFFICIAL to status_date. Absent dates SHALL be null. Under the user's explicit assumption, DATE_OFFICIAL SHALL be interpreted as the date the current status became official. The stored status SHALL be the standardized word for the reported STATUS. This mapping SHALL NOT modify agency inclusion rules or derive status from assignments.

#### Scenario: Inactive department with an open assignment

- **WHEN** a valid department reports INACTIVE, DATE_OFFICIAL 2004-01-07, and a qualifying open assignment
- **THEN** its agency remains eligible and carries status Inactive and status_date 2004-01-07

#### Scenario: Status-only update

- **WHEN** intake applies a source update that changes status and status_date
- **THEN** those values are persisted through the existing mutation pipeline without changing the agency ID, slug, or unrelated fields
