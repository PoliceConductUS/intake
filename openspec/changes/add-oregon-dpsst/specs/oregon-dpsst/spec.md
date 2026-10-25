## ADDED Requirements

### Requirement: Preserve and enumerate public source evidence

The source SHALL acquire all pages for each configured name prefix (A-Z by default),
retain unchanged HTML, deduplicate officer/agency affiliations by source identity,
and fetch each officer's employment and certification pages and linked agencies.
It SHALL distinguish a targeted prefix run from statewide coverage. It SHALL NOT
claim a complete acquisition on transport, parse, session or pagination failure.

#### Scenario: Search and detail pagination

- **WHEN** a public search or detail table has another page
- **THEN** acquisition follows its actual postback and retains every page.

#### Scenario: Public session expires

- **WHEN** the site redirects a request to its own public Logout page
- **THEN** acquisition opens and validates the public search form and retries that request once
- **AND** logs the renewal and fails on another redirect or any unrelated redirect.

#### Scenario: Missing agency

- **WHEN** the source explicitly responds No Data Found
- **THEN** preserve the response and report the agency as unavailable without
  inventing an address or emitting dangling assignment references.

#### Scenario: Agency lookup returns multiple rows

- **WHEN** an agency lookup returns multiple rows
- **THEN** select the unique row whose exact name matches the roster affiliation
- **AND** fail if the matching identity is missing or ambiguous.

#### Scenario: Resume interrupted statewide acquisition

- **WHEN** the CLI supplies a prior interrupted acquisition for the same prefixes
- **THEN** validate and reuse complete search prefixes, officer detail sets and agency responses
- **AND** fetch incomplete units again, preserving the prior command's raw evidence
- **AND** reject malformed saved identities, page sequences or a different prefix scope.

### Requirement: Deterministic source identities and truthful assignments

The transform SHALL emit existing import kinds only. DPSST numbers identify people,
agency codes identify agencies, and person plus agency plus actual hire date identify
employment episodes. Rank changes SHALL NOT create another employment episode.
Only an explicit Hired event opens an episode; explicit separation events close it.
Events such as leave, promotion and reclassification SHALL NOT fabricate hire dates.
An episode without an explicit separation can be open only when the affiliation is
currently Active; an inactive affiliation with no known end is reported unresolved.
Ambiguous duplicate hires, contradictory dates or unknown actions SHALL be reported
rather than resolved using guessed dates. Incomplete episodes remain in raw evidence.

#### Scenario: Rehire

- **WHEN** an officer is hired, separates, and is rehired at the same agency
- **THEN** emit two stable assignments keyed by their respective hire dates.

#### Scenario: Status change

- **WHEN** an officer is promoted or goes on leave
- **THEN** preserve the employment episode's identity and do not treat that event
  date as a hire or separation date.

### Requirement: Preserve certification meaning

Each distinct certificate type plus level SHALL identify an authority license.
Each person/type holding SHALL retain the source status and certificate award date.
The dated status SHALL be emitted as a license action. Expiration/probation dates
remain in raw evidence because the current license contract has no corresponding
fields. Certification status SHALL NOT substitute for employment status.

#### Scenario: Revoked certification

- **WHEN** a certificate is revoked with a source status date
- **THEN** emit the holding and the dated revocation without inferring employment
  termination or an allegation.

### Requirement: Use the shared intake boundary

The source SHALL keep network and filesystem acquisition separate from deterministic
transformation, emit source-local references through existing canonical artifact IO,
and use shared identity, field validation and property resolution during import.
It SHALL preserve all original responses and log every record omission and reason.

#### Scenario: Partial agency address

- **WHEN** an agency has insufficient address data
- **THEN** retain the original response and report it; do not invent location data
  or introduce source-specific shared-pipeline corrections.
