## ADDED Requirements

### Requirement: Oregon publication scope follows qualifying credentials

Oregon DPSST SHALL retain personnel only when at least one certificate belongs to Police Officer, Retired Police Officer, Corrections Officer, Parole & Probation Officer, Regulatory Specialist, Telecommunicator, or Telecommunicator Maintenance. All levels and statuses qualify, including historical, expired, suspended, revoked, and required certificates. Retained personnel SHALL retain all their credentials. Personnel with no qualifying certificates, including no certificates, SHALL be omitted with their dependent records. Agencies with no retained personnel assignments and their phone records SHALL be omitted. Unused authority license types SHALL be omitted. Raw source evidence SHALL remain intact. These scope omissions SHALL NOT create annotations or explicit exclusion cache entries and SHALL affect only Oregon source output, never delete another source's records.

#### Scenario: Medical-only personnel

- **WHEN** a person has only Emergency Medical Dispatcher, EMD Maintenance, or Instructor certificates
- **THEN** the Oregon output omits the person and dependents without annotations
- **AND** an agency with no remaining personnel is omitted

#### Scenario: Qualifying historical credential

- **WHEN** a person has a revoked Police Officer certificate and an Emergency Medical Dispatcher certificate
- **THEN** both credentials and the person remain in Oregon output

#### Scenario: No credentials

- **WHEN** a person has no certificates
- **THEN** the person is outside Oregon publication scope
