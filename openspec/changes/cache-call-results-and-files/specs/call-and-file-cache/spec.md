## ADDED Requirements

### Requirement: A call result is an entry of the resolved-property cache

A client SHALL keep each call it makes as a call entry of a `ResolvedProperty` envelope, the one cache. The envelope SHALL be the one of the record the call is made for, with the client operation as its target property; the entry SHALL be keyed by the fingerprint of the request. The request SHALL hold the service, the operation, the URL when there is one, the parameters, the prompt text when there is one, and the SHA-256 of each input. No other envelope kind SHALL hold call results.

#### Scenario: The same request is made twice

- **WHEN** a request equal to one whose current outcome succeeded and still stands is made
- **THEN** the cached answer is returned and the service is not called

#### Scenario: The prompt changes

- **WHEN** a request differs from a cached one only in its prompt text
- **THEN** it is a different entry, the service is called, and the earlier entry is kept

### Requirement: A request holds no key and no model

A request SHALL NOT hold an API key, an authorization header or a cookie. It SHALL NOT hold the model, so the model is not part of the fingerprint.

#### Scenario: The model changes

- **WHEN** a model call differs from one whose current outcome succeeded and still stands only in the model it asks for
- **THEN** it has the same fingerprint, the cached answer is returned and the service is not called

#### Scenario: A request carries a key

- **WHEN** a request's parameters hold an `Authorization` value
- **THEN** the request is rejected and nothing is written

### Requirement: An outcome records what is needed to reproduce the call

Each outcome SHALL record its status of succeeded or failed, its start and end time, the answer or the error, and, when the service gives them, the HTTP status, the provider's request ID, the stop reason and the token counts. It SHALL record the command that made the call and the intake version, except as the requirement "An outcome moved from an earlier cache says so" states. A PDF text outcome SHALL record the tool versions that ran.

#### Scenario: A model call fails

- **WHEN** a model call is refused
- **THEN** the entry's current outcome is failed and holds the stop reason, the provider's request ID, the model asked for and the model that answered, and the request holds the parameters and the prompt

### Requirement: A call entry keeps its earlier outcomes

A call entry SHALL keep its earlier outcomes; the last is the current one, and its value is the answer of its latest succeeded outcome. An envelope SHALL be written to a temporary name of its own writer and renamed. A write SHALL read the stored envelope first and SHALL fail, naming the file, when the new envelope would drop or change an outcome it holds.

#### Scenario: A write would drop an outcome

- **WHEN** an envelope is written whose entry leaves out an outcome the stored envelope holds
- **THEN** the write fails naming the file and the stored envelope is unchanged

### Requirement: An outcome moved from an earlier cache says so

An outcome written by the one-time workspace move of this change, which carries earlier caches into this one, SHALL carry `producedBy`, and MAY leave out its start time and the intake version, which the earlier files do not record. Every other outcome SHALL have both.

#### Scenario: A call carried over from a call log

- **WHEN** the move writes an outcome from a CourtListener call log
- **THEN** the outcome carries `producedBy` naming the log and has no start time and no intake version

#### Scenario: A call intake makes

- **WHEN** a client records an outcome without `producedBy` and without a start time
- **THEN** the envelope is rejected

### Requirement: A model call's outcome records the model

An outcome of a model call SHALL record the model the call asked for, and, when the service gave a response, the model that response names. A response that names no model SHALL be recorded as a failure of that item; the model asked for SHALL NOT be recorded in its place.

#### Scenario: The service answers with another model

- **WHEN** a model call asks for one model and the response names another
- **THEN** the succeeded outcome records the model asked for and the model the response names

#### Scenario: The response names no model

- **WHEN** a model call's response names no model
- **THEN** the entry's current outcome is failed with an item error and records no answering model

### Requirement: An outcome says when to call again

An outcome MAY carry `retryAfter`, an ISO 8601 date and time. The service SHALL NOT be called for that request before that time. At or after it the service SHALL be called again and a new outcome appended, except during `data reset --no-acquire`, as the requirement "A rebuild from retained inputs does not refresh the cache" states. An item failure SHALL carry a `retryAfter` 24 hours after it. A succeeded outcome with no `retryAfter` SHALL stand until the request changes.

#### Scenario: An outage inside its wait

- **WHEN** a request's current outcome failed for an outage with a `retryAfter` one hour ahead
- **THEN** the call is returned as skipped and the service is not called for that request

#### Scenario: A successful call that goes stale

- **WHEN** a request's current outcome succeeded with a `retryAfter` that has passed
- **THEN** the service is called again and the new outcome becomes current

#### Scenario: An item failure is tried again later

- **WHEN** a request's current outcome is an item failure recorded more than 24 hours ago
- **THEN** the service is called again

### Requirement: A bad stored result is retired through the CLI

An `intake cache` operation SHALL take the record by source identity, the client operation, the request fingerprint and a required `--message`, and SHALL append an outcome with the error kind `retired`, that message and a `retryAfter` of the time it ran. It SHALL NOT remove an outcome.

#### Scenario: A wrong answer is retired

- **WHEN** the operator retires a stored answer with a message
- **THEN** the next command that needs that request calls the service again, and the entry still holds the old answer and the retirement

### Requirement: A rebuild from retained inputs does not refresh the cache

`data reset --no-acquire` SHALL use the latest succeeded outcome as it is, even when its `retryAfter` has passed and even when a later attempt failed. A request with no succeeded outcome SHALL follow the rule for calling again.

#### Scenario: A reset with everything cached

- **WHEN** `data reset --no-acquire` runs and every request its records need has a succeeded outcome
- **THEN** no outside service is called

#### Scenario: A reset after a failed refresh

- **WHEN** `data reset --no-acquire` runs and a request's latest outcome failed after an earlier success
- **THEN** the earlier success is used and the service is not called

### Requirement: The downloads of one URL can be listed

The call entry for a download SHALL keep one outcome per download of that URL, each with the time and the facts of the file received, so that the files downloaded from a URL can be listed by date.

#### Scenario: A URL serves a different file later

- **WHEN** a URL is downloaded twice and the second file differs from the first
- **THEN** the entry for that URL lists both downloads with their times and SHA-256s
- **AND** both files are stored

### Requirement: A file is a record like any other

`BinaryFile` SHALL be one record kind with one spec, read and written through the standard envelope IO: SHA-256, extension, content type, byte count and workspace path. Its ID SHALL come from the source-name mapping with the SHA-256 as its source name and SHALL converge on the SHA-256, so the same bytes are one record. A record that has a file SHALL point at it with a foreign key and SHALL NOT store a path, hash, type or size of its own. The database SHALL NOT store the bytes.

#### Scenario: A personnel photo is imported

- **WHEN** `intake photo import` stores a WebP photo for a person
- **THEN** a `BinaryFile` record exists for the photo and the manual update it records sets the person's `photo_id` to that record

#### Scenario: Two sources keep the same file

- **WHEN** two sources keep the same bytes
- **THEN** there is one `BinaryFile` record with one ID, and its workspace path is the first one the bytes were stored at

### Requirement: A file's bytes are stored by namespace

The bytes of a file a source keeps SHALL be stored at `<workspace>/state/intake/namespaces/<namespace>/BinaryFile/<sha256>.<extension>`. The workspace path of the file's record SHALL be the first path its bytes were stored at, cached as a resolved property, and SHALL NOT change. A read SHALL fail, naming the file, when the bytes' SHA-256 or size is not the record's.

#### Scenario: The stored file was altered

- **WHEN** a file's bytes no longer hash to its record's SHA-256
- **THEN** reading it fails naming the file

### Requirement: Different files never share a name

A write SHALL fail, naming the file, when a file of the same name exists with different bytes, and SHALL write nothing.

#### Scenario: The name is taken by other bytes

- **WHEN** a file is stored whose SHA-256 names an existing file with different content
- **THEN** the write fails and the existing file is unchanged
