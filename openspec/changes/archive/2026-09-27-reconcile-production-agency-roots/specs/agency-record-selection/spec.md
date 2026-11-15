## MODIFIED Requirements

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

## ADDED Requirements

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
