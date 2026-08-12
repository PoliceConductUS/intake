## ADDED Requirements

### Requirement: TCOLE source emits all six kinds from the single workbook

The `sources/gov.tx.tcole/config.ts` source MUST read the single 02-10 workbook and
emit LicensingAuthority (TCOLE `/tx/`), Agency (`Departments`), Personnel
(`Officers`), Assignment (`Services`), License (distinct `PUBLIC_GUID`×`LICENSE`),
and LicenseAction (`OfficersLicensesActions`). `run()` MUST be deterministic (no
network, clock, or randomness).

#### Scenario: the workbook yields all six kinds
- **WHEN** `run()` receives the 02-10 workbook
- **THEN** the manifest contains LicensingAuthority, Agency, Personnel, Assignment (AgencyPersonnel), License, and LicenseAction records

#### Scenario: run() is deterministic
- **WHEN** `run()` executes twice on the same inputs
- **THEN** the two returned manifests and emitted records are deep-equal

### Requirement: Agency and Personnel field mappings

Agency records MUST be keyed by `DEPARTMENT_NUMBER` and MUST NOT carry `slug`,
`location_path_id`, `latitude`, or `longitude` (the import pipeline resolves those
via the Census geocoder). Personnel records MUST be keyed by `PUBLIC_GUID`.

#### Scenario: Departments become Agency records
- **WHEN** the Departments sheet has a row with `DEPARTMENT_NUMBER` = `471100`
- **THEN** an Agency record is emitted keyed by `471100` with `name` from
  `DEPARTMENT_NAME`, `state` from `STATE`, `city` from `CITY`, `address` from
  `ADD_LINE1`, `zip_code` from `ZIP_CODE`, `contact_name` from `HEAD_NAME`, and
  `contact_email` from `E_MAIL`

#### Scenario: Officers become Personnel records
- **WHEN** the Officers sheet has a row with `PUBLIC_GUID` = `1000033`
- **THEN** a Personnel record is emitted keyed by `1000033` with `first_name` from
  `FNAME`, `last_name` from `LNAME`, `middle_name` from `MNAME`, `suffix` from `SFX`

### Requirement: Assignment carries title and a license reference

An emitted Assignment (AgencyPersonnel) record MUST store the `APPOINTMENT` value
in `title` (the role — NOT the license), and MUST carry a `license` reference to
the officer's License (the source `LICENSE`, resolved via the ledger). It MUST be
keyed by the synthetic tuple
`PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE` (dates
`YYYY-MM-DD`, empty segment when null) to match the prior identity map. `agency_id`
carries `DEPARTMENT_NUMBER` and `personnel_id` carries `PUBLIC_GUID`.

#### Scenario: open-ended service maps title, license ref, and key
- **WHEN** a Services row has `PUBLIC_GUID`=`1000033`, `DEPARTMENT_NUMBER`=`471100`,
  `APPOINTMENT`=`Jailer`, `LICENSE`=`Temporary Jailer License`, `ST_DATE`=2024-10-15,
  and a null `END_DATE`
- **THEN** the record key is `1000033|471100|Jailer|Temporary Jailer License|2024-10-15|`
- **AND** `title` is `Jailer`, `license` references `1000033|Temporary Jailer License`,
  `start_date` is `2024-10-15`, `end_date` is null, `agency_id` is `471100`,
  `personnel_id` is `1000033`

### Requirement: Emitted cross-references resolve

An emitted record MUST NOT reference an unmapped key. Every source key a record
references — an Assignment's `DEPARTMENT_NUMBER`, `PUBLIC_GUID`, and `license`; a
License's `PUBLIC_GUID` and authority — has a corresponding emitted record in the
same run's manifest (or an already-seeded ledger entry), so the import transform
never hits an unmapped reference.

#### Scenario: every referenced agency, officer, and license is emitted
- **WHEN** an Assignment references `DEPARTMENT_NUMBER`=`471100`, `PUBLIC_GUID`=`1000033`,
  and license `1000033|Temporary Jailer License`
- **THEN** the run's manifest also contains an Agency keyed `471100`, a Personnel
  keyed `1000033`, and a License keyed `1000033|Temporary Jailer License`
