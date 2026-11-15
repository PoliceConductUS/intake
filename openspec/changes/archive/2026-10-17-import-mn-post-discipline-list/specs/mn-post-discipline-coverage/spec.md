## ADDED Requirements

### Requirement: Collect disciplined personnel independently of agency rosters

The MN POST source SHALL use license numbers from the supplied discipline workbook to collect personnel and actual discipline details regardless of license status or current agency assignment.

#### Scenario: Revoked license holder absent from agency roster

- **WHEN** the discipline workbook includes a revoked license holder not returned by agency collection
- **THEN** the source resolves the exact license number and emits that person and actual discipline actions
- **AND** each action references the person without requiring an agency link

### Requirement: Preserve exact source identity and evidence

The source SHALL preserve raw workbooks and source row references, reuse existing contact IDs and durable canonical mappings, and reject mismatched license search results.

#### Scenario: Same names with different license numbers

- **WHEN** two personnel share a name but have different source identities
- **THEN** name equality alone does not merge the personnel or transfer discipline

### Requirement: Preserve supplied employment history without inferring discipline attribution

The source SHALL join explicit history rows by license number and preserve supplied agency and start/end dates, while leaving discipline agency attribution absent unless the action provides it.

#### Scenario: Former Minneapolis employment

- **WHEN** a history row identifies a resolved person and agency with start and termination dates
- **THEN** it produces that former assignment with those dates
- **AND** it does not assert the person's discipline occurred there

### Requirement: Reconcile missing action details

The source SHALL distinguish the workbook discipline flag from actual order records and report missing action details without fabricating case numbers, actions, or dates.

#### Scenario: Flagged person with no returned actions

- **WHEN** a supplied license is flagged disciplined but POST returns no actions
- **THEN** the person is retained and the missing action details are reported explicitly

### Requirement: Retain person-level discipline during shared import selection

The shared import selector SHALL admit discipline and its referenced personnel independently of agency admission, retaining that person's license and education records through existing inclusion edges. It SHALL NOT admit unrelated personnel or infer agency links.

#### Scenario: Discipline has no agency assignment

- **WHEN** an incoming discipline references a person with no agency assignment
- **THEN** selection retains the discipline, person, and their supplied license records
- **AND** unrelated unassigned personnel remain outside selection

### Requirement: Retain explicitly declared personnel independently of returned actions

A source manifest MAY declare `personnelSourceNames` in the canonical Artifacts spec. Shared import SHALL resolve those source names only within the artifact namespace through the existing canonical identity ledger and retain matching personnel and their normal license, education, and discipline descendants. MN POST SHALL declare exactly the distinct contact IDs acquired from its supplied discipline workbook, including people whose action details are missing. This declaration SHALL NOT admit all personnel, broaden agency eligibility, or traverse from a person to an agency.

#### Scenario: Listed person has no returned actions or current employment

- **WHEN** MN POST declares a discipline-workbook person's contact ID and that person has no returned action or current assignment
- **THEN** import retains that person and supplied license and education records
- **AND** unrelated unassigned personnel remain excluded

#### Scenario: Explicit former history does not change agency admission

- **WHEN** a declared person has a supplied former assignment
- **THEN** the transform emits that assignment with source dates
- **AND** import includes the assignment only under the existing agency admission policy
- **AND** declaring the person does not itself admit the historical agency

### Requirement: Unresolved history agencies do not block resolved personnel

Acquisition SHALL preserve all history rows and explicitly report unresolved agency lookups with their source names and reasons. Unresolved history agencies alone SHALL NOT fail collection. Transform SHALL retain independently resolved personnel and actual discipline, omit only historical relationships whose missing agency identity is explicitly documented in the unresolved-agency report, and log each omitted source row with the license number and agency name. A missing agency ID without that explicit report SHALL remain an error. This SHALL NOT change identity matching or agency eligibility.

#### Scenario: Historical agency search has no result

- **WHEN** a person's identity is resolved and a supplied history agency has no ID and an explicit unresolved lookup report
- **THEN** the person's records remain available for import and the unresolved relationship is omitted with visible source-row context
- **AND** the unchanged source inventory and unresolved-agency report preserve the incomplete relationship evidence

#### Scenario: Missing identity is not documented

- **WHEN** a history agency has no ID and is absent from the unresolved-agency report
- **THEN** transform fails rather than silently dropping the relationship

### Requirement: Associate refreshed detail employment with confirmed request identity

For a confirmed workbook personnel request, transform SHALL associate its saved detail file with the inventory contact through the exact license ID and the collector's deterministic filename. An empty returned license list SHALL NOT discard that detail's explicit active employment. Transform SHALL NOT invent returned license rows or infer the contact from a name or an unrelated detail file; conflicting returned contact identities SHALL fail.

#### Scenario: Refreshed detail omits licenses but retains employment

- **WHEN** the confirmed inventory license ID identifies the saved detail filename and that detail has an empty license list and an explicit active roster ID
- **THEN** the roster assignment uses that explicit roster ID for the confirmed contact
- **AND** the empty returned license list is preserved unchanged

### Requirement: Preserve unresolved license inputs while importing confirmed personnel

The source SHALL preserve every unresolved discipline workbook license and its source row, search response, and resolution reason in the unresolved-license report. Unresolved licenses SHALL NOT block collection of independently confirmed personnel. Collection SHALL log the input, resolved, and unresolved license counts without claiming that every input resolved. Source identity conflicts, including a detail contact mismatch, SHALL remain fatal.

#### Scenario: User retains unresolved source licenses for later resolution

- **WHEN** all 571 supplied licenses have been checked and 34 remain unresolved
- **THEN** collection retains all 34 unresolved source rows and reasons
- **AND** allows independently confirmed personnel to continue to import
- **AND** reports 537 resolved licenses and 34 unresolved licenses from 571 inputs without inventing personnel identities

### Requirement: Preserve canonical identity when correcting source keys

The shared CLI SHALL support an evidence-referenced alias from a new source key to an existing source key within one namespace and entity kind, preserving the existing canonical ID and old forward mapping. It SHALL reject missing original mappings and conflicting new mappings, and persist command provenance before applying the alias. A newly created alias SHALL become the preferred reverse source name; replay of an existing matching alias SHALL preserve the current reverse mapping and report it.

#### Scenario: Official action identity replaces a colliding case label

- **WHEN** verified source evidence relates a new official action key to one existing imported record
- **THEN** the shared CLI records the evidence reference and maps the new key to that record's existing canonical ID
- **AND** the old forward mapping remains valid without altering database rows

#### Scenario: New key already identifies another record

- **WHEN** the new source key maps to a different canonical ID
- **THEN** alias creation fails without changing either mapping

### Requirement: Official complaint identity distinguishes disciplinary actions

MN POST SHALL key each discipline and its corresponding coverage link by `contactId|complaintId`, requiring the official complaint ID and retaining `caseNumber` as the visible case label. Distinct complaint IDs with the same contact and case label SHALL produce distinct records. Repeated copies of one complaint SHALL agree on the case label, action, and effective/expiration dates or fail visibly. Existing canonical record identities SHALL be preserved by verified shared source-name aliases before importing the new source keys.

#### Scenario: Reused case label

- **WHEN** two official complaints for one person share a case label but have distinct complaint IDs and dates
- **THEN** both discipline records and both coverage links are retained with their own source keys
- **AND** both preserve the supplied visible case label

#### Scenario: Missing complaint identity

- **WHEN** an action has no official complaint ID
- **THEN** transform fails without substituting its case label as identity

### Requirement: Missing order analysis does not erase stored narratives

When no analyzed order document is present for an action, MN POST SHALL omit allegation, violation, finding, chief_action, and sanction from that discipline's supplied fields. Shared import SHALL preserve stored values for omitted fields. An analysis that explicitly supplies null SHALL remain an explicit null, permitting the existing field-update semantics. Transform SHALL neither read the database nor substitute existing narrative values.

#### Scenario: Refresh includes action details without document analysis

- **WHEN** an existing discipline has narrative fields and the refreshed source includes its action but no analyzed document
- **THEN** the transformed record has no own narrative properties and import does not clear those stored fields

#### Scenario: Analysis explicitly supplies null

- **WHEN** a present analyzed document supplies null for a narrative field
- **THEN** the transformed record explicitly supplies that null
