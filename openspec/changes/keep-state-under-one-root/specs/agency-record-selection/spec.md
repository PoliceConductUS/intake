## MODIFIED Requirements

### Requirement: Initial agency roots for an empty database

Intake SHALL support a source-namespaced InitialAgencyRoots envelope whose unique source agency names supplement ordinary agency roots throughout a first multi-source import run. A data reset SHALL enable initial roots for its entire rebuild. A data update SHALL determine eligibility once from the empty agency table at the start of the run and pass that decision explicitly to every source import. A standalone import SHALL continue to determine eligibility from the agency table at its own start. Earlier sources in the same initial run SHALL NOT disable later sources' initial roots. Census and reference records SHALL NOT prevent this bootstrap. The envelope SHALL use strict canonical IO and SHALL be at `state/intake/namespaces/<namespace>/InitialAgencyRoots/`, intake's state about that source.

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

#### Scenario: The envelope's location

- **WHEN** intake loads the initial agency roots of `gov/texas/tcole`
- **THEN** it reads them from `state/intake/namespaces/gov/texas/tcole/InitialAgencyRoots/`
