## ADDED Requirements

### Requirement: Licensing authority entity with location-path jurisdiction

The system MUST add a `licensing_authority` table (`name`, `location_path_id`) and
a `LicensingAuthority` import kind. An authority's jurisdiction is the subtree of
its `location_path_id`; the authority for any officer or license MUST be resolvable
as the authority whose `location_path_id` is an ancestor of that entity's. Each
POST source declares one authority (TCOLE → `/tx/`).

#### Scenario: TCOLE authority is created at the state location path
- **WHEN** the TCOLE source runs
- **THEN** a `licensing_authority` row exists with `name` = "Texas Commission on
  Law Enforcement" and `location_path_id` referencing `/tx/`

#### Scenario: jurisdiction covers the location-path subtree
- **WHEN** an officer's resolved location path is `/tx/dallas-county/irving/`
- **THEN** TCOLE (`/tx/`) is the licensing authority whose jurisdiction contains that officer

### Requirement: License entity issued by an authority to a personnel

The system MUST add a `license` table (`officer_id`, `license_type`, `status`,
first-awarded date, `issued_by_authority_id` FK) unique on `(officer_id,
license_type)`, and a `License` import kind. A License MUST reference its holder
(`personnel_id` source key) and its issuing authority; both resolve via the ledger.

#### Scenario: a license is issued to an officer by TCOLE
- **WHEN** the workbook shows officer `1000033` holding `Temporary Jailer License`
- **THEN** a License record keyed `1000033|Temporary Jailer License` is emitted with
  `personnel_id`=`1000033` and `issued_by_authority_id` resolving to TCOLE

### Requirement: License action history

The system MUST add a `license_action` table and a `LicenseAction` import kind
capturing license events (`action`, `action_date`, resulting status) tied to a
License. LicenseAction records MUST be keyed by a stable synthetic tuple and
reference their License via the ledger.

#### Scenario: a license action is recorded against its license
- **WHEN** the source shows license `1000033|Temporary Jailer License` was `Granted`
  on 1995-12-20
- **THEN** a LicenseAction record is emitted referencing that License with
  `action`=`Granted` and `action_date`=`1995-12-20`

### Requirement: Assignment role/license model fix

The system MUST rename `agency_officers.license_type` to `title` and add a nullable
`agency_officers.license_id` FK. The `title` column MUST hold the role
(`APPOINTMENT`); `license_id` MUST reference the License the assignment is held
under. Existing `agency_officers` rows and their IDs MUST be preserved by the
rename.

#### Scenario: rename preserves existing rows
- **WHEN** the rename migration runs on a DB whose `agency_officers.license_type` holds role values
- **THEN** the column is named `title`, its values are unchanged, and row IDs are unchanged

#### Scenario: assignment links to its license
- **WHEN** the reconstruction runs and an assignment's source `LICENSE` matches an
  emitted License
- **THEN** the `agency_officers` row's `license_id` resolves to that License's canonical id

### Requirement: New kinds are additive to the import pipeline

The three new kinds MUST register additively — `importTypeRegistry` and the
`SourceNameToCanonicalId` entity handling gain `LicensingAuthority`, `License`, and
`LicenseAction`, while the existing `LocationPath*`, `Agency`, `Personnel`, and
`AgencyPersonnel` kinds behave exactly as before.

#### Scenario: existing kinds unaffected
- **WHEN** an artifacts envelope contains only the pre-existing kinds
- **THEN** the import behaves exactly as before the licensing kinds were added
