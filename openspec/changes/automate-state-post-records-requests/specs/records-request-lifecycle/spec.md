## ADDED Requirements

### Requirement: Request-capable state sources

Intake SHALL register Arkansas, Delaware, Florida, Mississippi, South Carolina, West Virginia, and Wisconsin as request-capable sources. Source discovery SHALL distinguish request capability from acquisition and transformation capability. Request-only sources SHALL NOT be treated as data transforms or cause routine data reset/update commands to submit requests.

#### Scenario: Request-only source discovery

- **WHEN** the user lists intake sources
- **THEN** each of the seven request sources appears with its supported request phase
- **AND** data-phase commands select only sources supporting the phase they execute

### Requirement: Durable request identity and historical evidence

Every request SHALL receive an intake-owned cuid2 before submission. The ID SHALL remain stable across retries and synchronization. New periodic requests SHALL have new IDs. Canonical RecordsRequest IO SHALL own strict envelope validation and persistence. The seven existing confirmed submissions SHALL be imported once with stable IDs, original date precision, reference numbers, and evidence limitations. Unsent Gmail drafts SHALL NOT be imported as submissions.

#### Scenario: Existing campaign import

- **WHEN** historical submission evidence is imported repeatedly
- **THEN** the same seven request identities remain
- **AND** no external request is sent
- **AND** the original evidence remains traceable

### Requirement: Default 90-day interval and explicit override

Submission SHALL be eligible by default only when at least 90 elapsed days have passed since the source's last confirmed submission. The CLI SHALL expose an explicit override. Submission eligibility and reservation SHALL be atomic per source so concurrent invocations cannot both submit within the interval. Sending failure SHALL NOT be represented as confirmed submission.

#### Scenario: Request before the interval expires

- **WHEN** the source has a confirmed request from fewer than 90 days ago and no override was provided
- **THEN** no request is sent
- **AND** the CLI reports the existing request ID and next eligible date

#### Scenario: Explicit early submission

- **WHEN** the user invokes submission with the interval override
- **THEN** a new request with a new cuid2 can be submitted before 90 days
- **AND** the request records that the interval was overridden

### Requirement: Prefer email through the Forms API provider

Where an agency accepts requests by email, intake SHALL prefer that route and send using Resend, the Forms API's email provider. The message SHALL include the internal request ID, agency scope, requester details, and complete generated standard request. Portal submission SHALL use a verified interface and capture its receipt. Unknown interfaces SHALL remain explicit blockers, not fabricated success.

#### Scenario: Agency supports email and a portal

- **WHEN** a request is eligible for submission
- **THEN** intake uses the verified email destination through Resend
- **AND** preserves the exact submitted text, attachment digests, and returned provider identifier

### Requirement: Track agency-assigned references separately

Intake SHALL persist agency-assigned request numbers and tracking locations when provided. Agency IDs and email-provider message IDs SHALL NOT replace the internal cuid2. Absence of an agency ID SHALL remain explicit.

#### Scenario: Agency assigns a number after submission

- **WHEN** a correlated acknowledgment contains an agency reference
- **THEN** synchronization records that reference against the existing request
- **AND** preserves the acknowledgment evidence

### Requirement: Evidence-based fulfillment reporting

Intake SHALL synchronize replies and returned records through Resend receiving and report pending versus fulfilled requests. Sending or delivery alone SHALL NOT indicate fulfillment. Acknowledgments and partial productions SHALL remain pending. Final-response evidence, returned records, denial, and no-records dispositions SHALL remain distinguishable. Ambiguous correspondence SHALL remain inspectable without guessing which request it belongs to.

#### Scenario: Acknowledgment without records

- **WHEN** an agency acknowledges receiving a request
- **THEN** its fulfillment state remains pending
- **AND** its acknowledgment and agency reference are reported when available

#### Scenario: Completed production

- **WHEN** a correlated final response confirms production and the provided records are saved
- **THEN** the request is reported as fulfilled with links to its response evidence and files

#### Scenario: Denied request

- **WHEN** a correlated final response denies the request
- **THEN** the denial is reported as a distinct final disposition
- **AND** it is not represented as delivered records

#### Scenario: Final response points to unsaved records

- **WHEN** a final response includes additional records that have not been saved, even after an earlier partial production
- **THEN** the request remains pending

#### Scenario: Uncertain delayed retry is reconciled

- **WHEN** a failed request is retried later and its uncertain result is confirmed by correspondence
- **THEN** the 90-day interval starts from the reconciled attempt, not the original request creation date
