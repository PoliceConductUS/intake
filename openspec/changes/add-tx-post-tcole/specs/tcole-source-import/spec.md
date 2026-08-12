## ADDED Requirements

### Requirement: TCOLE source emits Agency, Personnel, and AgencyPersonnel

The `sources/gov.tx.tcole/config.ts` source SHALL read the 02-10 TCOLE workbook
and return a manifest emitting Agency records (from the `Departments` sheet),
Personnel records (from the `Officers` sheet), and AgencyPersonnel records (from
the `Services` sheet). `run()` MUST be deterministic — no network, clock, or
randomness — and MUST NOT emit `slug`, `location_path_id`, `latitude`, or
`longitude` on Agency records (those are resolved by the import pipeline).

#### Scenario: Departments become Agency records keyed by department number
- **WHEN** the Departments sheet has a row with `DEPARTMENT_NUMBER` = `471100`
- **THEN** an Agency record is emitted keyed by `471100` with `name` from
  `DEPARTMENT_NAME`, `state` from `STATE`, `city` from `CITY`, `address` from
  `ADD_LINE1`, `zip_code` from `ZIP_CODE`, `contact_name` from `HEAD_NAME`, and
  `contact_email` from `E_MAIL`

#### Scenario: Officers become Personnel records keyed by PUBLIC_GUID
- **WHEN** the Officers sheet has a row with `PUBLIC_GUID` = `1000033`
- **THEN** a Personnel record is emitted keyed by `1000033` with `first_name`
  from `FNAME`, `last_name` from `LNAME`, `middle_name` from `MNAME`, and
  `suffix` from `SFX`

#### Scenario: run() is deterministic
- **WHEN** `run()` executes twice on the same inputs
- **THEN** the two returned manifests and emitted records are deep-equal

### Requirement: AgencyPersonnel key matches the prior identity map tuple

Each emitted AgencyPersonnel record SHALL be keyed by the synthetic tuple
`PUBLIC_GUID|DEPARTMENT_NUMBER|APPOINTMENT|LICENSE|ST_DATE|END_DATE`, with dates
formatted `YYYY-MM-DD` and an empty segment when a date is null, exactly matching
the abandoned identity map's `id_field`. The record's `agency_id` MUST carry the
source `DEPARTMENT_NUMBER` and `personnel_id` MUST carry the source `PUBLIC_GUID`
(the pipeline resolves both to canonical IDs via the ledger). The stored
`license_type` MUST be the `APPOINTMENT` (role) value — matching seed's
`agency_officers.title`→`license_type` column — NOT the `LICENSE` value.

#### Scenario: open-ended service produces a trailing-empty end-date segment
- **WHEN** a Services row has `PUBLIC_GUID`=`1000033`, `DEPARTMENT_NUMBER`=`471100`,
  `APPOINTMENT`=`Jailer`, `LICENSE`=`Temporary Jailer License`, `ST_DATE`=2024-10-15,
  and a null `END_DATE`
- **THEN** the AgencyPersonnel record key is
  `1000033|471100|Jailer|Temporary Jailer License|2024-10-15|`
- **AND** its `start_date` is `2024-10-15`, `end_date` is null, `license_type` is
  `Jailer` (the APPOINTMENT/role, not the LICENSE), `agency_id` is `471100`,
  `personnel_id` is `1000033`

### Requirement: Referential integrity of emitted cross-references

Every `DEPARTMENT_NUMBER` and `PUBLIC_GUID` referenced by an emitted
AgencyPersonnel record SHALL have a corresponding emitted Agency or Personnel
record, so the import transform never encounters an unmapped reference.

#### Scenario: every referenced agency and officer is emitted
- **WHEN** an AgencyPersonnel record references `DEPARTMENT_NUMBER`=`471100` and
  `PUBLIC_GUID`=`1000033`
- **THEN** the manifest also contains an Agency record keyed `471100` and a
  Personnel record keyed `1000033`
