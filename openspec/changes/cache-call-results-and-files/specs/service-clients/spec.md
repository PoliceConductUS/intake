## ADDED Requirements

### Requirement: One client per outside service

Intake SHALL have one client in shared code for each outside service it calls through the cache: a CourtListener client, an inference client and a file download client. A source or pipeline stage SHALL call a service only through its client, and SHALL be passed the client it needs. A client SHALL be the only code that reads or writes `CallResult` and `BinaryFile` envelopes for its service.

#### Scenario: Two sources summarize documents

- **WHEN** the CourtListener and Minnesota POST sources each need a model call
- **THEN** both use the same inference client

### Requirement: A client checks its service before its first call

Before its first call in a command, a client SHALL confirm that the service answers and, where the service needs a key, that a protected endpoint accepts it. A rejected key or no answer SHALL fail the command before any record is processed, naming the service.

#### Scenario: The CourtListener token is rejected

- **WHEN** the CourtListener client's check receives 401 or 403
- **THEN** the command exits non-zero naming CourtListener and the rejected token, and no call result is written for any docket

### Requirement: A client tells an item failure from a service failure

A client SHALL treat a 4xx answer other than 429 for one item, and a model refusal or unusable answer for one input, as a failure of that item: it SHALL record the outcome and return the failure to its caller. It SHALL treat no answer, a connection error, and throttling or server errors that outlast its retries as a failure of the service: it SHALL record the outcome with a `retryAfter` taken from the service's `Retry-After` header when given, and SHALL fail the command naming the service and that time.

#### Scenario: One document is missing

- **WHEN** a download answers 404 for one document
- **THEN** the caller receives the failure and the command continues with the next record

#### Scenario: The service stops answering

- **WHEN** a request times out and its retries time out
- **THEN** the command exits non-zero naming the service and the time to try again
- **AND** the records processed before it keep their cached results

### Requirement: API keys for clients come from Parameter Store

The `data generate`, `data update` and `data reset` commands SHALL give clients their API keys from Parameter Store in the same way as `data acquire`.

#### Scenario: Generate needs the inference key

- **WHEN** `data generate` makes its first model call
- **THEN** it uses the value stored in `/policeconduct/secrets/ANTHROPIC_API_KEY`
