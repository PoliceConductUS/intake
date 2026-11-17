## ADDED Requirements

### Requirement: A call result is cached by its request

The cache SHALL hold a `CallResult` envelope for each distinct request, under the namespace of the source that asked, at `<workspace>/state/intake/namespaces/<namespace>/CallResult/<fingerprint>.CallResult.yaml`, where the fingerprint is the SHA-256 of the request's stable JSON. The request SHALL hold the service, the operation, the URL or the model, the parameters, the prompt text when there is one, and the SHA-256 of each input. It SHALL NOT hold an API key or an authorization header.

#### Scenario: The same request is made twice

- **WHEN** a request equal to one whose current outcome succeeded is made
- **THEN** the cached response is returned and the service is not called

#### Scenario: The prompt changes

- **WHEN** a request differs from a cached one only in its prompt text
- **THEN** it has a different fingerprint, the service is called, and the earlier envelope is kept

### Requirement: An outcome records what is needed to reproduce the call

Each outcome SHALL record its status of succeeded or failed, its start and end time, the response or the error, and, when the service gives them, the HTTP status, the provider's request ID, the stop reason and the token counts. It SHALL record the command that made the call and the intake version. An envelope SHALL keep its earlier outcomes; the last is the current one.

#### Scenario: A model call fails

- **WHEN** a model call is refused
- **THEN** the envelope's current outcome is failed and holds the stop reason, the provider's request ID and the model, parameters and prompt of the request

### Requirement: An outcome says when to call again

An outcome MAY carry `retryAfter`, an ISO 8601 date and time. The service SHALL NOT be called for that request before that time. At or after it the service SHALL be called again and a new outcome appended. An outcome with no `retryAfter` SHALL stand until the request changes.

#### Scenario: A failed call inside its wait

- **WHEN** a request's current outcome is failed with a `retryAfter` one hour ahead
- **THEN** the failure is returned and the service is not called

#### Scenario: A successful call that goes stale

- **WHEN** a request's current outcome succeeded with a `retryAfter` that has passed
- **THEN** the service is called again and the new outcome becomes current

### Requirement: The downloads of one URL can be listed

The call result for a download SHALL keep one outcome per download of that URL, each with the time and the SHA-256 of the file received, so that the files downloaded from a URL can be listed by date and each fetched by its SHA-256.

#### Scenario: A URL serves a different file later

- **WHEN** a URL is downloaded twice and the second file differs from the first
- **THEN** the call result for that URL lists both downloads with their times and SHA-256s
- **AND** both files are in the cache

#### Scenario: A URL serves the same file again

- **WHEN** a URL is downloaded again and the file's SHA-256 is unchanged
- **THEN** the new outcome names the same file and no second copy is stored

### Requirement: A file is cached by its content

The cache SHALL hold a `BinaryFile` envelope for each distinct file content at `<workspace>/state/intake/namespaces/<namespace>/BinaryFile/<sha256>.BinaryFile.yaml`, with the file beside it as `<sha256>.<extension>`. The envelope SHALL record the byte count, the content type, and the origin: for a download the full URL, the time and the HTTP status; for a local file its name and the time. A read SHALL fail when the file's SHA-256 does not equal its name.

#### Scenario: A PDF is downloaded

- **WHEN** a download returns a PDF
- **THEN** the cache holds `<sha256>.BinaryFile.yaml` and `<sha256>.pdf`, and the call result for the download names that file

#### Scenario: The stored file was altered

- **WHEN** a binary file's bytes no longer hash to its name
- **THEN** reading it fails naming the file

### Requirement: A binary file is a record that other records point at

`BinaryFile` SHALL be a record kind holding the file's SHA-256, extension, content type and byte count, with an ID resolved from its SHA-256 through the source-name mapping. A record that has a file SHALL point at it with a foreign key and SHALL NOT store a path, hash, type or size of its own. Intake SHALL NOT store or decide where a file is published; the website build decides that from the file's record.

#### Scenario: A personnel photo is imported

- **WHEN** `intake file import` stores a WebP photo for a person
- **THEN** a `BinaryFile` record exists for the photo and the person's `photo_id` points at it

#### Scenario: The same file is stored again

- **WHEN** the same bytes are stored a second time
- **THEN** the same `BinaryFile` record is used, with the same ID, and no second file is written

### Requirement: Different files never share a name

A write SHALL fail, naming the file, when a file of the same name exists with different bytes, and SHALL write nothing.

#### Scenario: The name is taken by other bytes

- **WHEN** a file is stored whose SHA-256 names an existing file with different content
- **THEN** the write fails and the existing file is unchanged

### Requirement: Existing source caches are moved into the cache once

`intake cache migrate` SHALL move what the workspace holds in the CourtListener, Minnesota POST and personnel photo caches into `CallResult` and `BinaryFile` envelopes, SHALL report what it moved and what it could not, and SHALL change nothing when run again.

#### Scenario: Minnesota documents

- **WHEN** the workspace holds an order PDF in a command folder and its text and analysis in the Minnesota state folder
- **THEN** after the move the cache holds the PDF as a binary file and the text and analysis as call results whose input is that file's SHA-256
- **AND** a later `data generate` makes no call for that document

#### Scenario: A reviewed analysis

- **WHEN** a Minnesota analysis was produced by a document review and not by the model
- **THEN** its call result's outcome says a document review produced it and does not name the model as its producer
