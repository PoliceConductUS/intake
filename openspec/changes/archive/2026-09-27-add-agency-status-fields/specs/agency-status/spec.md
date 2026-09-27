## ADDED Requirements

### Requirement: Agency retains optional source-reported status and date

Agency records SHALL support nullable text status and nullable date status_date. A supplied status SHALL be nonblank. Canonical artifacts and create/update contracts SHALL expose these fields. Sources that omit either field SHALL retain the existing absent-field update behavior. A known status SHALL NOT require a known status_date.

#### Scenario: Status with unknown official date

- **WHEN** an agency has status INACTIVE and no supplied status date
- **THEN** intake stores INACTIVE and null status_date

#### Scenario: Nullable fields on existing records

- **WHEN** the migration runs against existing agency rows
- **THEN** both new columns are null without changing other columns or record identities

### Requirement: TCOLE preserves reported agency status

TCOLE SHALL map STATUS to agency status and DATE_OFFICIAL to status_date. Absent dates SHALL be null. Under the user's explicit assumption, DATE_OFFICIAL SHALL be interpreted as the date the current status became official. This mapping SHALL NOT modify agency inclusion rules or derive status from assignments.

#### Scenario: Inactive department with an open assignment

- **WHEN** a valid department reports INACTIVE, DATE_OFFICIAL 2004-01-07, and a qualifying open assignment
- **THEN** its agency remains eligible and carries status INACTIVE and status_date 2004-01-07

#### Scenario: Status-only update

- **WHEN** intake applies a source update that changes status and status_date
- **THEN** those values are persisted through the existing mutation pipeline without changing the agency ID, slug, or unrelated fields

### Requirement: MN POST maps only agency operating status evidence

MN POST SHALL NOT map officer license status or Primary/Secondary employment designations to Agency.status. Its currently acquired inputs supply no agency operating status or status date, so both Agency fields SHALL remain omitted by that source.

#### Scenario: Employment designation is not agency status

- **WHEN** officer details report activeEmployment.agencyStatus Primary or Secondary and a roster reports an Active license
- **THEN** MN POST emits neither agency status nor status_date from those values
