## ADDED Requirements

### Requirement: One client per outside service

Intake SHALL have one shared client each for CourtListener, inference, file download and PDF text. Code SHALL call CourtListener, a model or the PDF text programs only through these clients, and a `data generate` resolver and the Minnesota POST order download SHALL download a file only through the file download client. Each SHALL be passed the client it needs and SHALL name the record it calls for. The requirement "Code that still calls a service itself is named" names the exceptions.

#### Scenario: Two sources summarize documents

- **WHEN** the CourtListener and Minnesota POST resolvers each need a model call
- **THEN** both use the same inference client code

### Requirement: Only the resolved-property store writes call results

Within intake, call entries SHALL be read and written only through the resolved-property store. A file's bytes SHALL be written only through one store operation, which the clients and the `photo` command use.

#### Scenario: A photo is imported

- **WHEN** `intake photo import` stores a photo
- **THEN** it writes the bytes through the same store operation a client uses

### Requirement: A client checks its service before its first call

Before its first call in a command that the cache does not answer, a client SHALL confirm that the service answers and, where the service needs a key, that a protected endpoint accepts it. The inference client's check SHALL also confirm that the model asked for exists. A rejected key, a missing model or no answer SHALL stop that source's work at that point, naming the service, and that call SHALL NOT be made.

#### Scenario: The CourtListener token is rejected

- **WHEN** the CourtListener client's check receives 401 or 403
- **THEN** the command exits non-zero naming CourtListener and saying its token was rejected, without the token's value, and no call is recorded for any docket

#### Scenario: The model does not exist

- **WHEN** the inference client's check finds that the model asked for does not exist
- **THEN** the command exits non-zero naming the model, and no model call is made

### Requirement: A failed check ends the command non-zero

After a failed check the command SHALL exit non-zero. `data update` SHALL first go on with its next source; every other command SHALL run no later source.

#### Scenario: An update with a source whose service is down

- **WHEN** `data update` processes two sources and the first one's check fails
- **THEN** the second source is processed and the command exits non-zero naming the first source's service

### Requirement: A check is made only when the cache cannot answer

A command whose calls the cache answers wholly SHALL make no check. For downloads, each host SHALL be checked and marked down on its own.

#### Scenario: Every call is cached

- **WHEN** a command's every call has a standing outcome
- **THEN** no client checks its service and no key is read

### Requirement: The PDF text client checks the programs it runs

The PDF text client SHALL check all four programs it runs (`pdfinfo`, `pdftotext`, `pdftoppm`, `tesseract`) and SHALL name in one message every program that cannot be run. `mise.toml` SHALL pin the tools that provide them. A program run that fails or passes its time limit SHALL be a failure of that file.

#### Scenario: PDF programs are not installed

- **WHEN** the PDF text client's check finds that `pdftoppm` and `tesseract` cannot be run
- **THEN** the command exits non-zero with one message that names both programs and says `mise install` provides them, and no call is recorded for any file

### Requirement: A client tells an item failure from an outage

A client SHALL treat an empty answer as a success. A 4xx answer other than 401, 403 and 429, a model refusal or an unusable answer SHALL be a failure of that item, recorded and returned to the caller. Any other failure that outlasts the retries (no answer, a connection error, 429, 5xx, 401, 403, an account or credit error) SHALL be an outage only when the service check, run again, also fails; otherwise it SHALL be a failure of that item.

#### Scenario: One document is missing

- **WHEN** a download answers 404 for one document
- **THEN** the caller receives the failure and the command continues with the next record

#### Scenario: A search finds nothing

- **WHEN** a CourtListener search answers with no results
- **THEN** the outcome is succeeded with an empty answer

#### Scenario: One item's server error

- **WHEN** a call answers 500 through every retry and the service check run again answers
- **THEN** the call is a failure of that item and later calls to the service are made

### Requirement: An outage skips the service's later calls

When a service is down, the client SHALL record the failed outcome with a `retryAfter` taken from the service's `Retry-After` header when given and one hour after the failure otherwise, and SHALL return "skipped" for that call and for every later call to that service in the command that the cache does not answer, without trying the service again. The next command SHALL check the service again. A call SHALL be skipped only for an outage.

#### Scenario: The next run

- **WHEN** the command runs again after the `retryAfter` time and the service answers
- **THEN** the skipped calls are made

### Requirement: An acquire with failed or skipped calls fails at its end

An acquire SHALL make every call it can, so that their answers are kept, and SHALL then exit non-zero naming each call that failed or was skipped. It SHALL NOT be recorded as completed.

#### Scenario: CourtListener goes down partway through an acquire

- **WHEN** CourtListener goes down while the acquire still has agencies to search
- **THEN** the acquire writes the dockets files of the searches that answered, exits non-zero naming each skipped search, and is not recorded as completed

#### Scenario: One search fails

- **WHEN** one agency's search fails as an item and every other search answers
- **THEN** the acquire exits non-zero naming that search and is not recorded as completed

### Requirement: A skipped call in data generate changes nothing and is reported

In `data generate`, `data update` and `data reset`, a caller that receives "skipped" SHALL leave unchanged whatever the call would have filled, SHALL NOT report a finding, and SHALL state that the findings reported on earlier runs for that record are kept. The output of the import that made the calls SHALL end by naming the service, the time it went down when that command found the outage, the number of calls skipped and the time to try again, and the command SHALL exit 0.

#### Scenario: Records whose calls were skipped

- **WHEN** a service goes down during `data generate`, with records still to process
- **THEN** each record that needed the service keeps the values it had, with no new annotation and no annotation resolved
- **AND** the last lines of that import's output name the service, the time it went down, the calls skipped and the time to try again, and the command exits 0

### Requirement: Clients count their calls

Each client SHALL count the calls it made, the calls the cache answered and the calls it skipped, and `data reset` SHALL print these per service at its end with the size of the cache and of the folders that hold files.

#### Scenario: A reset served from the cache

- **WHEN** `data reset --no-acquire` runs and the cache answers every call
- **THEN** its last lines show zero calls made and the number of calls the cache answered, per service

### Requirement: Code that still calls a service itself is named

Until the change that moves it, this code SHALL be the only code that calls a model or the PDF text programs, or downloads a Minnesota order, without a client: the Minnesota acquire's order downloads, text extraction and analysis, until the Minnesota task; `requests sync`; and the news inference.

#### Scenario: A new source calls a service

- **WHEN** a new source or resolver needs CourtListener, a model or the PDF text programs
- **THEN** it uses the client for that service
