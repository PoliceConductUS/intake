## ADDED Requirements

### Requirement: license_action table and LicenseAction import kind

The system SHALL add a `license_action` database table and register a fifth
import kind, `LicenseAction`, in the import type registry and the
`SourceNameToCanonicalId` entity handling, so the pipeline can transform and load
license-action records end to end. The extension MUST be additive and MUST NOT
change the behavior of the existing four kinds.

#### Scenario: LicenseAction participates in the import pipeline
- **WHEN** an artifacts envelope contains a `LicenseActions` artifact
- **THEN** the import resolves canonical IDs for its records, transforms them into
  `license_action` rows, and plans database mutations for them alongside the other kinds

#### Scenario: existing kinds are unaffected
- **WHEN** an artifacts envelope contains only Agency/Personnel/AgencyPersonnel
- **THEN** the import behaves exactly as before the LicenseAction kind was added

### Requirement: LicenseAction sourced from the 02-04 TCOLE file

The TCOLE source SHALL emit LicenseAction records from the 02-04 workbook's
`3.license` rows (310,970 rows), keyed by a stable synthetic tuple, with
`personnel_id` carrying the source `PUBLIC_GUID` (resolved to a canonical ID via
the ledger). License-action rows are new to the database, so each SHALL receive a
freshly minted `cuid2`.

#### Scenario: a license-action row becomes a LicenseAction record
- **WHEN** a `3.license` row has `PUBLIC_GUID`, `SERVICE_LICENSE`/`LICENSE_TITLE`,
  `ACTION_DATE`, and `ACTION_DESCRIPTION`
- **THEN** a LicenseAction record is emitted referencing `personnel_id` =
  `PUBLIC_GUID` with the license, action date, and description mapped onto the
  `license_action` columns
