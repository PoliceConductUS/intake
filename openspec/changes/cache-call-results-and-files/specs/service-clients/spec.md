## ADDED Requirements

### Requirement: One client per outside service

Intake SHALL have one client in shared code for each outside service it calls through the cache: a CourtListener client, an inference client and a file download client. A source or pipeline stage SHALL call a service only through its client, and SHALL be passed the client it needs. A client SHALL be the only code that reads or writes `CallResult` and `BinaryFile` envelopes for its service.

#### Scenario: Two sources summarize documents

- **WHEN** the CourtListener and Minnesota POST sources each need a model call
- **THEN** both use the same inference client

### Requirement: A client checks its service before its first call

Before its first call in a command, a client SHALL confirm that the service answers and, where the service needs a key, that a protected endpoint accepts it. A rejected key or no answer SHALL stop the command before any record is processed, naming the service: a command SHALL NOT start work that needs a service that is down.

#### Scenario: The CourtListener token is rejected

- **WHEN** the CourtListener client's check receives 401 or 403
- **THEN** the command exits non-zero naming CourtListener and the rejected token, and no call result is written for any docket

### Requirement: The PDF text client checks the programs it runs

The PDF text client SHALL check all four programs it runs (`pdfinfo`, `pdftotext`, `pdftoppm`, `tesseract`) and SHALL name in one message every program that cannot be run. `mise.toml` SHALL pin the tools that provide them.

#### Scenario: PDF programs are not installed

- **WHEN** the PDF text client's check finds that `pdftoppm` and `tesseract` cannot be run
- **THEN** the command exits non-zero with one message that names both programs and says `mise install` provides them, and no call result is written for any file

### Requirement: A client tells an item failure from an outage

A client SHALL treat a 4xx answer other than 429 for one item, and a model refusal or unusable answer for one input, as a failure of that item: it SHALL record the outcome and return the failure to its caller. It SHALL treat no answer, a connection error, and throttling or server errors that outlast its retries as an outage of the service.

#### Scenario: One document is missing

- **WHEN** a download answers 404 for one document
- **THEN** the caller receives the failure and the command continues with the next record

### Requirement: An outage during a command skips, and does not stop it

When a service goes down after a command has started, the client SHALL record the failed outcome with a `retryAfter` taken from the service's `Retry-After` header when given, SHALL return "skipped" for that call and for every later call to that service in the command without trying the service again, and SHALL NOT fail the command. A call SHALL be skipped only for an outage.

#### Scenario: The service stops answering partway through

- **WHEN** a request times out and its retries time out, with records still to process
- **THEN** the command continues, makes no further call to that service, and exits zero

#### Scenario: The next run

- **WHEN** the command runs again after the `retryAfter` time and the service answers
- **THEN** the skipped calls are made

### Requirement: A skipped call changes nothing and is reported

A caller that receives "skipped" SHALL leave unchanged whatever the call would have filled and SHALL NOT report a finding. The command SHALL end by naming the service, the number of calls skipped and the time to try again.

#### Scenario: Records whose calls were skipped

- **WHEN** a service goes down during a command, with records still to process
- **THEN** each record that needed the service keeps the values it had, with no new annotation
- **AND** the last lines name the service, the calls skipped and the time to try again

### Requirement: API keys for clients come from Parameter Store

The `data generate`, `data update` and `data reset` commands SHALL give clients their API keys from Parameter Store in the same way as `data acquire`.

#### Scenario: Generate needs the inference key

- **WHEN** `data generate` makes its first model call
- **THEN** it uses the value stored in `/policeconduct/secrets/ANTHROPIC_API_KEY`
