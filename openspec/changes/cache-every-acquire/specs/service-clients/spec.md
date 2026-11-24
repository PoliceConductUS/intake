## ADDED Requirements

### Requirement: The file download client takes the request and the attempt from its caller

The file download client SHALL let its caller name the operation and the parameters that decide the answer when the URL alone does not, and SHALL let its caller supply the attempt that makes the call. The request SHALL hold the URL, the operation and those parameters, and no parameters key when the caller names none.

#### Scenario: Two form posts to one URL

- **WHEN** two calls post to one URL with different parameters
- **THEN** each has its own call result

#### Scenario: A plain download

- **WHEN** a caller names no operation and no parameters
- **THEN** the request is `{ service: "download", operation: "get", url }`, with no parameters key

### Requirement: The client records what a caller's attempt returns

The file download client SHALL record what a caller's attempt returns: a file, a JSON response, an item failure or an outage. An attempt that throws SHALL fail the command, and nothing SHALL be recorded for it.

#### Scenario: An attempt throws

- **WHEN** a caller's attempt throws
- **THEN** the command fails naming the call, and its call result is unchanged

#### Scenario: An attempt rejects an answer

- **WHEN** a caller's attempt returns an item failure because the answer fails its check
- **THEN** the call result records an item failure with the attempt's message, the call is not retried, and the host's later calls are made

#### Scenario: An attempt reports an outage

- **WHEN** a caller's attempt returns an outage on every try
- **THEN** the client retries it, then records a failed outcome with `retryAfter` and skips the host's later calls that the cache does not answer

### Requirement: The download host check uses the client's own fetch

The check before the first call to a download host SHALL use the client's own fetch, never a caller's attempt.

#### Scenario: The first call to a host has an attempt

- **WHEN** the first uncached call to a host is made with a caller's attempt
- **THEN** the host check is made with the client's own fetch, and the attempt is called only for that call's request

### Requirement: A download request holds no session state

A download request SHALL NOT hold anything a session hands out: a view state, an event validation value, a cookie, a session or page token, an action ID or a request counter.

#### Scenario: The same request in a new session

- **WHEN** a call is made in a new session whose session state differs from the session of an earlier call with the same URL, operation and parameters
- **THEN** it has the same fingerprint, and the earlier answer is returned without a call while it stands

## MODIFIED Requirements

### Requirement: A client tells an item failure from an outage

A client SHALL treat a 4xx answer other than 429 for one item, and a model refusal or unusable answer for one input, as a failure of that item: it SHALL record the outcome and return the failure to its caller. It SHALL treat no answer, a connection error, and throttling or server errors that outlast its retries as an outage of the service. For a call made by a caller's attempt, the attempt sorts its answer into an item failure or an outage, and the client SHALL treat it as the attempt says.

#### Scenario: One document is missing

- **WHEN** a download answers 404 for one document
- **THEN** the caller receives the failure and the command continues with the next record

### Requirement: An outage during a command skips, and does not stop it

When a service goes down after a command has started, the client SHALL record the failed outcome with a `retryAfter` taken from the service's `Retry-After` header when given and one hour after the failure otherwise, SHALL return "skipped" for that call and for every later call to that service in the same source's run that the cache does not answer, without trying the service again, and SHALL NOT itself fail the command. A call SHALL be skipped only for an outage. A caller whose output needs a skipped answer decides whether its command fails; the acquires that `config-driven-source-import` names fail at their end.

#### Scenario: The service stops answering partway through

- **WHEN** a request times out and its retries time out, with records still to process
- **THEN** the client returns "skipped" for that call and makes no further call to that service for that source
- **AND** the command goes on with the calls that do not need that service

#### Scenario: The next run

- **WHEN** the command runs again after the `retryAfter` time and the service answers
- **THEN** the skipped calls are made
