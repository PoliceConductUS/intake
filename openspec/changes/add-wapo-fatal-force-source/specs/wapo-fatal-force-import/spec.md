## ADDED Requirements

### Requirement: Acquire pins an upstream commit and preserves file provenance

The `sources/org.washingtonpost.fatal-force/acquire.ts` phase MUST download the
two v2 files — `fatal-police-shootings-data.csv` and
`fatal-police-shootings-agencies.csv` — from an **explicit upstream commit SHA**,
never from a moving branch ref. It MUST preserve the original bytes unmodified
and record, for each file, `sourceUrl`, `commit`, `sha256`, `byteLength`, and
`retrievedAt`. All network access lives in acquire.

#### Scenario: acquiring at a pinned commit preserves bytes and provenance

- **WHEN** acquire runs for a configured upstream commit SHA
- **THEN** both CSVs are stored unmodified alongside their sourceUrl, commit, sha256, byteLength, and retrievedAt

#### Scenario: re-acquiring an unchanged pin is a no-op

- **WHEN** acquire runs again with the same commit SHA and the files are already preserved
- **THEN** it does not re-download and does not rewrite the preserved evidence

#### Scenario: a moving ref is rejected

- **WHEN** the source is configured with a branch name instead of a commit SHA
- **THEN** acquire fails before downloading, rather than fetching an unpinned snapshot

### Requirement: Transform is deterministic over saved inputs

`transform.ts` MUST read only the saved inputs and MUST declare
`produces: ["FatalShootings", "FatalShootingAgencies"]`. It MUST NOT access the
network, the wall clock, or any source of randomness. The same input bytes MUST
produce the same manifest.

#### Scenario: identical inputs produce an identical manifest

- **WHEN** transform runs twice over the same preserved input bytes
- **THEN** both runs return the same records, in the same order, with the same source-local names

### Requirement: Records are keyed by the upstream record id

Each incident record's source-local name MUST be the upstream `id` value, and
each reported-agency record's source-local name MUST be the upstream agency `id`
value. The source MUST NOT mint canonical IDs and MUST NOT maintain its own
canonical mapping.

#### Scenario: canonical identity is resolved by root intake

- **WHEN** transform emits an incident whose upstream id is 11295
- **THEN** the record is named by that upstream id and root intake resolves it to a canonical id through the durable source-name ledger

### Requirement: The source never creates an agency and never guesses one

`fatal_shooting_agency.agency_id` MUST be nullable. It MUST be populated only
when the reported agency resolves to an agency the database already holds,
through the existing resolver. It MUST be left null otherwise. This source MUST
NOT create an agency, and MUST NOT select a best-guess match on name and state.

#### Scenario: an unresolved reported agency is preserved as unresolved

- **WHEN** a reported agency does not resolve to an existing agency
- **THEN** the record is imported with a null agency_id and its reported name, type, state, and ORI codes intact

#### Scenario: no agency is created from the agency file

- **WHEN** the agency file names an agency absent from the database
- **THEN** no agency row is created, because the file carries no address and AgencyCreateSpec requires a location path and coordinates

### Requirement: ORI codes are stored as reported, never as a key

The reported agency's ORI codes MUST be stored verbatim as source-reported text.
They MUST NOT be used as a primary key, a join key, or a uniqueness constraint,
because one reported agency may carry several ORI codes and may carry none.

#### Scenario: a reported agency carrying several ORI codes imports intact

- **WHEN** a reported agency lists more than one ORI code
- **THEN** every listed code is preserved on that one record, without splitting it into several agencies

#### Scenario: a reported agency carrying no ORI code imports intact

- **WHEN** a reported agency lists no ORI code
- **THEN** the record imports with its ORI codes absent, and is not rejected

### Requirement: Re-import of an unchanged corpus is a no-op after comparison

Re-running the pipeline against an unchanged pin MUST compare the supplied source
fields against the imported rows and produce an empty diff. It MUST NOT use an
existence-only skip, `ON CONFLICT`, or an unconditional read to make the re-run
appear idempotent. A changed pin MUST produce a visible diff or a loud failure.

#### Scenario: an unchanged corpus produces an empty diff

- **WHEN** generate runs against an unchanged pin whose records are already imported
- **THEN** the chain entry is empty because every field compared equal, not because the records were skipped

#### Scenario: a changed upstream record produces a visible update

- **WHEN** the pin moves to a commit in which an incident's fields differ
- **THEN** generate emits an update for that record, or fails loudly under the existing field constraints

### Requirement: Source attribution and redistribution class are recorded

The source MUST record its licence as CC BY-NC-SA 4.0 and carry
`redistribution_class: noncommercial_sharealike`. Any public API response or bulk
export MUST exclude records carrying that redistribution class until a different
licence grant is recorded.

#### Scenario: a ShareAlike-licensed source is excluded from an open export

- **WHEN** a bulk export is generated
- **THEN** records whose redistribution class is noncommercial_sharealike are excluded, rather than relying on an operator to remember

### Requirement: Decedent-level records are not published

Records imported by this source MUST NOT render on any public page. Only
aggregate measures that identify no individual may be published from this
corpus, and only when the board has recorded that decision.

#### Scenario: an imported incident does not reach a public page

- **WHEN** pages are generated after this source is imported
- **THEN** no page renders a decedent name or any decedent-level attribute from this corpus

#### Scenario: an aggregate annual count is publishable

- **WHEN** an aggregate count of incidents per year is prepared for publication
- **THEN** it identifies no individual and carries the source attribution and licence notice
