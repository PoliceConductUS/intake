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

### Requirement: Source adapters omit invalid records without weakening validation

The TCOLE source SHALL validate agency candidates against the canonical Agency spec and report and omit invalid records. city null SHALL remain invalid. Assignments and contacts referencing an omitted agency SHALL not be emitted. Raw source data SHALL remain intact. Source validity filtering SHALL remain distinct from shared agency eligibility selection, and omission SHALL NOT delete stored records.

#### Scenario: Department with invalid address data

- **WHEN** an agency candidate contains null city, address, or zip_code and fails the existing canonical spec
- **THEN** the source reports the agency source identity and invalid fields and omits the agency and its dependent assignments and contacts
- **AND** valid agency candidates remain available to shared selection

### Requirement: Shared agency address validation rejects approved placeholders

Shared Agency field validation SHALL reject city and address values NULL, 0, x, xx, -----, N/A, and test after trimming and case-folding. ZIP values SHALL match five digits or ZIP+4 and SHALL NOT start with an all-zero five-digit ZIP. These rules SHALL apply to canonical agency artifacts and create/update validation for every source. Existing optional artifact fields SHALL remain optional; required create fields SHALL remain required. Ambiguous short addresses such as 341, rere, and 12t SHALL NOT be banned by this change. No global string validator SHALL be tightened for unrelated fields.

#### Scenario: Invalid placeholder address from any source

- **WHEN** an Agency contains one of the approved address or city placeholders, including mixed case or surrounding whitespace
- **THEN** the canonical field validation rejects it

#### Scenario: Postal format

- **WHEN** an agency ZIP is 0, 00000, 00000-0000, or a malformed ZIP
- **THEN** it is rejected
- **AND** valid ZIPs with leading zeros and valid ZIP+4 values remain accepted

### Requirement: Initial agency roots for an empty database

Intake SHALL support a source-namespaced InitialAgencyRoots envelope whose unique source agency names supplement ordinary agency roots only when the agency table is empty at import preparation. Census and reference records SHALL NOT prevent this bootstrap. The envelope SHALL use strict canonical IO and the intake-owned namespace state location.

Current production agency membership SHALL be determined from the live production sitemap. Local membership SHALL be determined from the post-reset local database. Except for the explicitly retired duplicate pages and the four Minnesota agency identity reconciliations deferred by the user, for every production agency slug absent from the local set, its canonical Agency ID and source ID SHALL be determined through exact local database and durable cache mappings and its determined source ID SHALL be included in initial root data. Address state, geography, status, assignment history, and case links SHALL NOT filter this reconciliation. Existing initial roots SHALL remain. An old database backup SHALL NOT establish current production membership. An agency appearing only in a source export SHALL NOT enter this supplemental list merely because it appears in that export. Unresolved or ambiguous mappings SHALL remain inspectable and SHALL NOT be guessed or represented as completed reconciliation.

Initial roots SHALL select their directed descendants using shared traversal. They SHALL NOT bypass source validation or explicit exclusions, fabricate absent records, alter canonical IDs/slugs, or exclude other ordinary qualifying roots. Nonempty imports SHALL retain existing selection behavior. An absent initial-root envelope SHALL mean no supplemental roots; a malformed envelope read for bootstrap SHALL fail visibly.

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

- **WHEN** the agency table already contains any agency
- **THEN** the initial root list does not add roots and ordinary open-assignment/case qualification and existing-record retention apply

#### Scenario: Invalid or excluded candidate

- **WHEN** a listed source agency is invalid, explicitly excluded, or absent from the incoming candidates
- **THEN** the initial list does not fabricate or reintroduce that agency

#### Scenario: Additional qualifying agency

- **WHEN** a valid agency outside the initial list has a null-ended assignment or available case relationship
- **THEN** it remains selected through ordinary roots

### Requirement: Retired duplicate Texas agency pages

The duplicate agency identities `azc6n47oplmlxa1cu0izal7wwoyv` / `dallas-police-department-tx-woyv`, `vt2zc6c6hi4k2665vm30h4ltpy90` / `fort-worth-police-department-tx-py90`, and `vxvk51wclfh4urgbdwxt46bf28dj` / `texas-department-of-public-safety-tx-28dj` SHALL NOT be restored as agencies by manual intake or included in local agency build inputs. Their presence in the production sitemap SHALL NOT cause bootstrap restoration. Explicit manual-source exclusions SHALL record the retired identities and the selected survivors.

The selected existing identities SHALL remain `cm76wpxb701ggvrvgmu50aa9n` / `dallas-police-department-d32dea`, `cm7a0bgon037gewvgoqo5jqsu` / `fort-worth-police-department-a80e5e`, and `cm7a0bgoo03ekewvgxw2elv24` / `texas-department-of-public-safety-7f40bb`. Existing relationships SHALL remain attached to surviving records; this retirement does not authorize fabricating missing historical relationships or deleting personnel or cases. Historical raw inputs SHALL remain preserved as evidence and SHALL NOT be treated as active seed inputs. Ordinary intake SHALL remain non-deleting.

#### Scenario: Manual restoration attempts to recreate a rejected duplicate

- **WHEN** manual intake emits any of the three retired Agency source keys
- **THEN** the existing explicit-exclusion stage removes that agency before writing import artifacts
- **AND** the corresponding selected survivor is not excluded

#### Scenario: Agency pages generated from the rebuilt database

- **WHEN** agency build inputs are read from the rebuilt local database
- **THEN** none of the three rejected IDs or slugs is present
- **AND** all three selected survivor IDs and slugs remain unchanged

### Requirement: Deferred Minnesota identity reconciliation

This reconciliation SHALL leave the existing local canonical IDs, slugs and source mappings of Brooklyn Center Police Department, Minneapolis Police Department, Minnesota State Patrol and St. Anthony Police Department unchanged. Their production/local identity differences SHALL be reported as explicitly deferred, not silently merged or declared resolved.

#### Scenario: Skipped Minnesota identity difference

- **WHEN** the rebuilt local database contains one of the four deferred Minnesota agencies under a slug different from the production page
- **THEN** this correction preserves its existing local ID/slug and source mapping
- **AND** the audit reports the production difference as deferred by user direction

### Requirement: Confirmed cross-source federal agency identities

The federal office source names `fbi-headquarters`, `dea-headquarters`, `atf-headquarters`, and `usss-headquarters` SHALL resolve respectively to the selected existing Agency IDs `cm7a0bgot046gewvgtaafjyui`, `cm7a0bgot046oewvgozeu75gj`, `cm7a0bgot046mewvgs6xyqymp`, and `cm7a0bgot046iewvg5qs1f9cn`. Their established survivor slugs SHALL remain unchanged. Forward and reverse mappings SHALL agree, and replaced mapping evidence SHALL remain inspectable. These corrections SHALL NOT broaden agency selection or merge distinct agencies or district offices.

#### Scenario: A later source describes the same selected agency

- **WHEN** federal intake resolves one of the four confirmed office source names
- **THEN** it resolves to the selected existing TCOLE Agency identity
- **AND** it does not recreate the alternate agency ID or replace the established slug
