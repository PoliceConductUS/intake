## ADDED Requirements

### Requirement: Person Records Carry No Displayable Attributes

A person record MUST NOT contain displayable attribute columns. Every fact
about a person MUST exist only as a cited claim or a cited name variant.

#### Scenario: Person has no name columns

- **WHEN** the columns of `public.person` are inspected
- **THEN** they are exactly `person_id`, `legacy_officer_id`, `created_at`, `updated_at`

#### Scenario: Name variants require a citation

- **WHEN** a `person_name_variant` is inserted without `retrieval_id`
- **THEN** the database rejects the write

### Requirement: Identity Resolution Links, Never Merges

The same human appearing under multiple person records MUST be represented by a
reversible confidence-scored link. No identity operation may rewrite or delete
an existing person record.

#### Scenario: Linking leaves both records intact

- **WHEN** two person records are linked as `possible_same_person`
- **THEN** both person records still exist unchanged

#### Scenario: Identity pairs are canonically ordered

- **WHEN** a link is inserted with `person_id_a` greater than or equal to `person_id_b`
- **THEN** the database rejects the write with `person_identity_link_ordered`

#### Scenario: Reviewed negatives are representable

- **WHEN** two person records are reviewed and found to be different people
- **THEN** a `distinct_person` link can be recorded so the candidate is not re-proposed

### Requirement: Same-Person Acceptance Requires Human Or Certificate Evidence

An automated probabilistic match MUST NOT accept a `same_person` link on its
own authority.

#### Scenario: Probabilistic method cannot self-accept

- **WHEN** a `same_person` link with method `probabilistic_score` is inserted with status `accepted`
- **THEN** the database rejects the write

#### Scenario: Non-proposed links require a reviewer

- **WHEN** a link is inserted with status `accepted` or `rejected` and no reviewer
- **THEN** the database rejects the write with `person_identity_link_review_complete`

### Requirement: Employment Spans Agencies And Carries Provenance

A person's employment at an agency MUST be modeled as its own cited assertion
so that a career crossing multiple agencies is representable.

#### Scenario: Employment requires a citation

- **WHEN** an `employment_period` is inserted without `retrieval_id`
- **THEN** the database rejects the write

#### Scenario: Employment attributes are claims, not columns

- **WHEN** the columns of `public.employment_period` are inspected
- **THEN** they contain no rank, badge number, or employment date columns
