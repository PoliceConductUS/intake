## MODIFIED Requirements

### Requirement: Open assignments and civil cases determine agency roots

Shared intake SHALL select the unique UNION of agency IDs referenced by assignments whose effective end_date is exactly null, agency IDs linked to a civil case, and office Agency IDs linked to a federal organization through `parent_federal_agency_id`. The current schema represents case-agency connections through CivilCasePersonnel -> AgencyPersonnel -> Agency; selection SHALL use that relationship without introducing a CaseAgency table. Agency STATUS SHALL NOT determine selection. All current and past assignments at a selected agency SHALL be included, along with their personnel. For each import, assignment/case root agencies SHALL be the union of agencies qualifying before and after incoming records are overlaid on the stored canonical graph. Federal office inclusion SHALL follow the effective parent reference. Traversal SHALL follow the effective incoming graph. This retains the agency as a root for the dataset that closes its last open assignment. Later sources can attach data to previously imported assignments. Missing end_date in a new candidate SHALL NOT independently establish a qualifying assignment.

#### Scenario: Past employment at a qualifying agency

- **WHEN** A has one null-ended assignment and one ended assignment
- **THEN** A, both assignments, and both personnel are selected

#### Scenario: Shared personnel do not qualify another agency

- **WHEN** a selected person has a historical assignment at B and B has no null-ended assignments, linked civil case, or federal parent
- **THEN** B and that assignment are not selected

#### Scenario: Incoming end date supersedes stored null

- **WHEN** an incoming assignment closes the only stored open assignment at an agency with no linked civil case
- **THEN** the agency remains a root for this import because it qualified before the update
- **AND** its new end date is stored; that ended assignment does not qualify the agency for subsequent imports

### Requirement: Shared directed inclusion graph

Intake SHALL declare the inclusion edges as shared metadata and traverse them only in their declared direction. Agency descendants include assignments, personnel, licenses, license actions, agency contacts, assignment-linked cases, reviews, disciplines, coverage, arrest profiles, and their evidence links. Traversal SHALL NOT expand through shared cases or personnel into other assignments or through reference data into unrelated records; federal organizations SHALL traverse only their office Agency relationships and the ordinary directed descendants of those offices. Explicitly excluded records SHALL remain excluded. Selected records SHALL NOT retain a required reference to a deliberately unselected candidate.

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

State/location records, licensing authorities, authority license types, and federal organization reference records SHALL remain independently importable. Intake SHALL derive independent root kinds from the shared inclusion graph as kinds without an incoming inclusion edge, without a per-kind allowlist. Federal organizations SHALL have a directed inclusion edge to office Agency records through `parent_federal_agency_id`, without requiring open assignments or linked civil cases. A license SHALL retain its reference to its state's authority without making that authority a traversal bridge to unrelated licenses or personnel.

#### Scenario: Shared licensing authority

- **WHEN** selected and unselected personnel have licenses from the same authority
- **THEN** the reference authority is retained and only licenses reached from selected personnel or assignments are selected

#### Scenario: Federal offices without personnel or cases

- **WHEN** new or existing Agency candidates reference an incoming or stored federal parent
- **THEN** those office agencies and their directed descendants are selected even
  with no assignments or only ended assignments and no linked civil cases
- **AND** unrelated nonfederal agencies remain subject to ordinary eligibility

### Requirement: Intake never deletes records

Intake SHALL NOT delete stored records. Inclusion eligibility SHALL govern new records; incoming updates to an existing canonical record SHALL remain eligible even when its agency no longer qualifies. Retaining an existing record SHALL NOT itself qualify the agency or select new descendants.

#### Scenario: Last assignment ends

- **WHEN** the last open assignment receives an end date and its agency has no linked case
- **THEN** intake records the end date and retains the agency, personnel, assignments, and stored history
- **AND** new descendants are selected in that import because the agency qualified before the update; subsequent imports use the updated graph

#### Scenario: No qualifying assignment

- **WHEN** an agency has only ended assignments, no linked civil case, and no federal parent
- **THEN** its unimported candidates remain inspectable but produce no create mutations; updates to stored records remain eligible

### Requirement: Initial agency roots for an empty database

Intake SHALL support a source-namespaced InitialAgencyRoots envelope whose unique source agency names supplement ordinary agency roots throughout a first multi-source import run. A data reset SHALL enable initial roots for its entire rebuild. A data update SHALL determine eligibility once from the empty agency table at the start of the run and pass that decision explicitly to every source import. A standalone import SHALL continue to determine eligibility from the agency table at its own start. Earlier sources in the same initial run SHALL NOT disable later sources' initial roots. Census and reference records SHALL NOT prevent this bootstrap. The envelope SHALL use strict canonical IO and the intake-owned namespace state location.

Current production agency membership SHALL be determined from the live production sitemap. Local membership SHALL be determined from the post-reset local database. Except for the explicitly retired duplicate pages and the four Minnesota agency identity reconciliations deferred by the user, for every production agency slug absent from the local set, its canonical Agency ID and source ID SHALL be determined through exact local database and durable cache mappings and its determined source ID SHALL be included in initial root data. Address state, geography, status, assignment history, and case links SHALL NOT filter this reconciliation. Existing initial roots SHALL remain. An old database backup SHALL NOT establish current production membership. An agency appearing only in a source export SHALL NOT enter this supplemental list merely because it appears in that export. Unresolved or ambiguous mappings SHALL remain inspectable and SHALL NOT be guessed or represented as completed reconciliation.

Initial roots SHALL select their directed descendants using shared traversal. They SHALL NOT bypass source validation or explicit exclusions, fabricate absent records, alter canonical IDs/slugs, or exclude other ordinary qualifying roots. Runs that begin with a nonempty agency table SHALL retain existing selection behavior. An absent initial-root envelope SHALL mean no supplemental roots; a malformed envelope read for bootstrap SHALL fail visibly.

#### Scenario: Production agency outside Texas

- **WHEN** the current production sitemap contains an agency slug absent from the post-reset local database and it resolves to a TCOLE source ID
- **THEN** that source ID is included in the initial root list regardless of address state or assignment history
- **AND** normal source validation and explicit exclusions still govern admission

#### Scenario: Local-only agency

- **WHEN** a post-reset local agency slug is absent from the current production sitemap
- **THEN** it is not treated as a production omission or used to expand initial roots by this reconciliation

#### Scenario: No exact source mapping

- **WHEN** a mismatched agency slug cannot be mapped unambiguously to a canonical Agency ID and source ID
- **THEN** the missing mapping is reported explicitly without inventing an ID or claiming the reconciliation is complete

#### Scenario: Historical agency during initial import

- **WHEN** the agency table is empty and a valid candidate appears in the saved initial source-name list with only ended assignments
- **THEN** that agency and its directed reachable records are selected with their established canonical IDs and slugs

#### Scenario: Existing database does not bootstrap new historical agencies

- **WHEN** a standalone import or multi-source update starts with any agency already in the table
- **THEN** the initial root list does not add roots and ordinary open-assignment/case qualification and existing-record retention apply

#### Scenario: Invalid or excluded candidate

- **WHEN** a listed source agency is invalid, explicitly excluded, or absent from the incoming candidates
- **THEN** the initial list does not fabricate or reintroduce that agency

#### Scenario: Additional qualifying agency

- **WHEN** a valid agency outside the initial list has a null-ended assignment or available case relationship
- **THEN** it remains selected through ordinary roots

#### Scenario: An earlier source populates agencies during initial import

- **WHEN** a reset or initially empty update imports reference parents and offices before a roster with saved initial agencies
- **THEN** the roster's saved initial agencies and their directed descendants are included
- **AND** this behavior uses shared run context, without special handling for a source or entity kind
