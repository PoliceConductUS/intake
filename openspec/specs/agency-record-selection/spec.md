# agency-record-selection Specification

## Purpose

Select new records through qualifying agency roots across sources while preserving stored records, factual updates, canonical identities, and source evidence.

## Requirements

### Requirement: Open assignments and civil cases determine agency roots

Shared intake SHALL select the unique UNION of agency IDs referenced by assignments whose effective end_date is exactly null and agency IDs linked to a civil case. The current schema represents case-agency connections through CivilCasePersonnel -> AgencyPersonnel -> Agency; selection SHALL use that relationship without introducing a CaseAgency table. Agency STATUS SHALL NOT determine selection. All current and past assignments at a selected agency SHALL be included, along with their personnel. For each import, root agencies SHALL be the union of agencies qualifying before and after incoming records are overlaid on the stored canonical graph. Traversal SHALL follow the effective incoming graph. This retains the agency as a root for the dataset that closes its last open assignment. Later sources can attach data to previously imported assignments. Missing end_date in a new candidate SHALL NOT independently establish a qualifying assignment.

#### Scenario: Past employment at a qualifying agency

- **WHEN** A has one null-ended assignment and one ended assignment
- **THEN** A, both assignments, and both personnel are selected

#### Scenario: Shared personnel do not qualify another agency

- **WHEN** a selected person has a historical assignment at B and B has no null-ended assignments or linked civil case
- **THEN** B and that assignment are not selected

#### Scenario: Incoming end date supersedes stored null

- **WHEN** an incoming assignment closes the only stored open assignment at an agency with no linked civil case
- **THEN** the agency remains a root for this import because it qualified before the update
- **AND** its new end date is stored; that ended assignment does not qualify the agency for subsequent imports

### Requirement: Shared directed inclusion graph

Intake SHALL declare the inclusion edges as shared metadata and traverse them only in their declared direction. Agency descendants include assignments, personnel, licenses, license actions, agency contacts and links, federal branch links, assignment-linked cases, reviews, disciplines, coverage, arrest profiles, and their evidence links. Traversal SHALL NOT expand through shared cases or personnel into other assignments or through reference data into unrelated records. Explicitly excluded records SHALL remain excluded. Selected records SHALL NOT retain a required reference to a deliberately unselected candidate.

#### Scenario: Case references two agencies

- **WHEN** a civil case links assignments at two agencies, including an agency with only historical assignments
- **THEN** both agency IDs enter the root union and both case links are selected
- **AND** all assignments at both agencies and their directed descendants are selected

#### Scenario: Case root alone

- **WHEN** an agency has no null-ended assignments but a civil case references one of its historical assignments
- **THEN** it is selected as a case root

#### Scenario: Overlapping root sets

- **WHEN** an agency has both a null-ended assignment and a linked civil case
- **THEN** the agency and each reachable record are selected once

#### Scenario: Later source adds a report

- **WHEN** a report source references an existing assignment at a qualifying agency
- **THEN** the report, assignment link, and report evidence links are selected without requiring the source to re-emit the agency

### Requirement: Reference data remains independent

State/location records, licensing authorities, authority license types, and federal organization reference records SHALL remain independently importable. A license SHALL retain its reference to its state's authority without making that authority a traversal bridge to unrelated licenses or personnel.

#### Scenario: Shared licensing authority

- **WHEN** selected and unselected personnel have licenses from the same authority
- **THEN** the reference authority is retained and only licenses reached from selected personnel or assignments are selected

### Requirement: Preserve evidence and identity

Source adapters SHALL emit otherwise valid candidate agencies, personnel, and assignments without preempting the shared agency eligibility rule. MN current roster assignments SHALL explicitly emit end_date null. Selection SHALL preserve raw inputs and candidate artifacts, canonical IDs, source mappings, and URLs, and SHALL report excluded candidate counts. Exclusion SHALL NOT issue database deletes. Missing required data SHALL remain a visible validation error rather than being reported as successful inclusion.

#### Scenario: TCOLE inactive status with an open assignment

- **WHEN** a department has STATUS INACTIVE but has a valid null-ended assignment
- **THEN** the source emits the candidates and shared selection includes the agency and its reachable records

### Requirement: Intake never deletes records

Intake SHALL NOT delete stored records. Inclusion eligibility SHALL govern new records; incoming updates to an existing canonical record SHALL remain eligible even when its agency no longer qualifies. Retaining an existing record SHALL NOT itself qualify the agency or select new descendants.

#### Scenario: Last assignment ends

- **WHEN** the last open assignment receives an end date and its agency has no linked case
- **THEN** intake records the end date and retains the agency, personnel, assignments, and stored history
- **AND** new descendants are selected in that import because the agency qualified before the update; subsequent imports use the updated graph

#### Scenario: No qualifying assignment

- **WHEN** an agency has only ended assignments and no linked civil case
- **THEN** its unimported candidates remain inspectable but produce no create mutations; updates to stored records remain eligible

### Requirement: Selection uses available case relationships

Case qualification SHALL use incoming and stored case relationships available to the import. CourtListener acquisition and matching SHALL remain unchanged; an agency may be excluded before CourtListener is queried.

#### Scenario: Historical-only agency precedes case discovery

- **WHEN** a new agency has only ended assignments and no case relationship available to its import
- **THEN** it may be excluded before CourtListener searches imported agencies
- **AND** selection does not stage or import the agency solely to discover a future case
