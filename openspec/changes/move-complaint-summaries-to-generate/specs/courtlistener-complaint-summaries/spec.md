## ADDED Requirements

### Requirement: The acquire only lists dockets

The CourtListener acquire SHALL search for each agency's dockets through the shared CourtListener client and write each agency's `dockets.json`, named by the agency's source ID. It SHALL NOT fetch docket entries, download a document or make a model call, and SHALL write no other file to its command folder.

#### Scenario: A full acquire

- **WHEN** the acquire runs for every agency
- **THEN** the only requests it makes are searches, and each agency has one `dockets.json`

### Requirement: A civil case's complaint summary is worked out in generate

For a civil case whose primary source URL is a docket on `www.courtlistener.com`, `data generate` SHALL fetch the docket's entries, select the latest identified complaint, download its PDF, confirm it is a PDF, compare its SHA-1 with the one CourtListener records, extract its text from the downloaded file, and ask the model for a summary, each through the shared client for that service. The summary's source SHALL state whether the SHA-1 matched. A case with any other primary source URL SHALL be left as it is.

#### Scenario: A complaint that can be summarized

- **WHEN** a case's complaint is available, passes its checks and is summarized
- **THEN** the case carries the summary with the document's URL, its CourtListener page, its filing date, its SHA-1 and SHA-256, and the model the service's response named
- **AND** the summary's source states that the SHA-1 matched

#### Scenario: Nothing has changed since the last run

- **WHEN** `data generate` runs again and every call result for a case still stands
- **THEN** no request is made for that case and its summary is unchanged

#### Scenario: The prompt changes

- **WHEN** the summary prompt is changed
- **THEN** the next `data generate` asks the model again for each case and reuses the cached entries, PDF and text

### Requirement: A complaint problem does not keep the case out or stop the command

When a case's complaint cannot be summarized, `data generate` SHALL write the case with no summary and the unavailability state for the problem, SHALL report a finding of the type shown, and SHALL continue with the next record.

| Code                   | Problem                                          | Unavailability state   | Type    |
| ---------------------- | ------------------------------------------------ | ---------------------- | ------- |
| `complaint-entries`    | The docket's entries cannot be fetched or read   | retrieval_failed       | error   |
| `complaint-not-found`  | No complaint is identified in the entries        | pending                | warning |
| `complaint-no-copy`    | The identified complaint has no available copy   | missing_copy           | warning |
| `complaint-download`   | The PDF cannot be downloaded                     | retrieval_failed       | warning |
| `complaint-no-check`   | CourtListener records no SHA-1 for the file      | retrieval_failed       | error   |
| `complaint-not-pdf`    | The served file is not a readable PDF            | retrieval_failed       | error   |
| `complaint-no-text`    | No text can be extracted from the PDF            | available_unsummarized | warning |
| `complaint-no-summary` | The model refuses or returns an unusable summary | available_unsummarized | warning |

An error is a case where CourtListener's own data is wrong or contradicts itself. A warning is a case where something is absent or could not be used.

#### Scenario: The problem goes away

- **WHEN** a later `data generate` summarizes a complaint that had a problem
- **THEN** the case receives its summary and the annotation is resolved, keeping its ID

### Requirement: A complaint whose file does not match its recorded SHA-1 is summarized and annotated

When a downloaded PDF's SHA-1 differs from the one CourtListener records, `data generate` SHALL keep the served file in the cache under its own SHA-256, summarize its extracted text, and write the case with the summary and no unavailability state. The summary's source SHALL state that the SHA-1 did not match. `data generate` SHALL report one error finding with code `complaint-mismatch` on the case and SHALL continue with the next record.

#### Scenario: The served file does not match the recorded SHA-1

- **WHEN** a downloaded PDF's SHA-1 differs from the one CourtListener records
- **THEN** the case is written with a summary made from the served file, whose source states that the SHA-1 did not match
- **AND** the case carries one error annotation whose value holds the recorded SHA-1, the served file's SHA-1 and SHA-256, and its byte count
- **AND** the served file stays in the cache under its SHA-256
- **AND** `data generate` continues and exits zero

#### Scenario: A mismatched file that cannot be summarized

- **WHEN** a downloaded PDF does not match its recorded SHA-1 and no text can be extracted from it
- **THEN** the case is written with no summary, the `available_unsummarized` state, the `complaint-mismatch` annotation and the `complaint-no-text` annotation

#### Scenario: The file later matches

- **WHEN** a later `data generate` downloads a file whose SHA-1 equals the recorded one
- **THEN** the case's summary is made from that file and the `complaint-mismatch` annotation is resolved, keeping its ID

### Requirement: An outage during generate leaves a case as it was

When a service a case's complaint needs goes down during `data generate`, the case SHALL keep the summary and unavailability state it had, SHALL receive no new annotation, and SHALL be processed on the next run. `data generate` SHALL continue and exit zero.

#### Scenario: The model service goes down partway through

- **WHEN** the inference service stops answering after some cases are summarized
- **THEN** the remaining cases keep their existing summary fields and annotations unchanged
- **AND** the next `data generate`, with the service back, summarizes them

### Requirement: A problem is tried again when its call result says so

A complaint problem SHALL be tried again only when the cached call result behind it no longer stands: its `retryAfter` has passed, or the request has changed.

#### Scenario: A download that failed for one document

- **WHEN** a download answered 404 and `data generate` runs the next day
- **THEN** no request is made for that file and the case keeps its state and annotation

#### Scenario: The docket's entries are refreshed

- **WHEN** the entries call result's `retryAfter` has passed and the new entries identify an available complaint
- **THEN** the complaint is downloaded and summarized

### Requirement: Intake writes the annotation's reader-facing text

Each finding's message SHALL be the text below with the addresses filled in, and nothing more: that we tried to summarize the complaint, why we could not, and where to look. The `complaint-mismatch` message says instead that a summary was made, why it should not be trusted, and where to look. `<docket>` SHALL be the docket's full URL on `www.courtlistener.com`. `<complaint>` SHALL be the full URL of the complaint document's page on `www.courtlistener.com`; when the complaint has no such page, the docket's URL SHALL be used. An address on any other host SHALL NOT be used. The unavailability state's source URL SHALL be the address the message gives.

| Code                   | Message                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `complaint-entries`    | We could not summarize the complaint in this case because we could not get the list of documents filed in it. The case on CourtListener: `<docket>`                                                                                                                                                                               |
| `complaint-not-found`  | We could not summarize the complaint in this case because we could not find it among the documents filed. The case on CourtListener: `<docket>`                                                                                                                                                                                   |
| `complaint-no-copy`    | We could not summarize the complaint in this case because a free copy of it is not available. The case on CourtListener: `<docket>` You can help: if you buy the complaint from PACER with the free RECAP browser extension installed, it becomes free for everyone on CourtListener. How to set that up: https://free.law/recap/ |
| `complaint-download`   | We could not summarize the complaint in this case because we could not download it. The complaint: `<complaint>`                                                                                                                                                                                                                  |
| `complaint-no-check`   | We could not summarize the complaint in this case because we could not confirm that the copy we found is the right file. The complaint: `<complaint>`                                                                                                                                                                             |
| `complaint-mismatch`   | The summary of the complaint in this case was made from a copy that is not the file CourtListener has on record. Do not trust the summary, or anything else on this page that was worked out from that copy. The complaint: `<complaint>`                                                                                         |
| `complaint-not-pdf`    | We could not summarize the complaint in this case because the file could not be opened. The complaint: `<complaint>`                                                                                                                                                                                                              |
| `complaint-no-text`    | We could not summarize the complaint in this case because its text could not be read. The complaint: `<complaint>`                                                                                                                                                                                                                |
| `complaint-no-summary` | We tried to summarize the complaint in this case and could not. The complaint: `<complaint>`                                                                                                                                                                                                                                      |

#### Scenario: No free copy

- **WHEN** the identified complaint has no available copy
- **THEN** the annotation's message is the `complaint-no-copy` text, with the docket's address and `https://free.law/recap/`

#### Scenario: A file that fails its check

- **WHEN** the served file does not match the recorded SHA-1
- **THEN** the annotation's message is the `complaint-mismatch` text and does not contain "SHA-1"

#### Scenario: The complaint has no page of its own

- **WHEN** a complaint cannot be downloaded and has no CourtListener page
- **THEN** the `complaint-download` text gives the docket's address

### Requirement: An annotation's evidence names its sources

A complaint finding's evidence SHALL hold one source record for the docket, one for the complaint document when one is identified, and one for the downloaded file when there is one. Each SHALL state what it is (`docket`, `complaint document` or `downloaded file`), the source namespace, its full URL, and, when the item was retrieved, the time and its SHA-256.

#### Scenario: Evidence for a mismatched file

- **WHEN** a downloaded PDF does not match its recorded SHA-1
- **THEN** the evidence holds a docket source, a complaint document source, and a downloaded file source with the download URL, the time and the served file's SHA-256

### Requirement: A docket that names an officer but cannot build a case is annotated on the licensing authority

When a docket has a party who matches an officer of its agency but has no title or no valid filing date, the transform SHALL write no case for it and SHALL report a warning finding with code `docket-not-buildable` on the licensing authority of the agency's state, with the docket as the finding's source record. The message SHALL read: "A court case naming an officer of `<agency name>` is not shown on this site because CourtListener, a free website of court records, lists it without `<a title | a filing date | a title and a filing date>`. You can see the case here: `<address>`".

#### Scenario: Two such dockets in one state

- **WHEN** two Texas dockets each lack a filing date
- **THEN** the Texas licensing authority carries two warning annotations, one per docket

#### Scenario: The last such docket is fixed

- **WHEN** a later transform finds no such docket for Texas
- **THEN** the Texas licensing authority record is still emitted with an empty list and the earlier annotations are resolved

### Requirement: A docket left out for want of an officer is logged

A docket with no party who matches an officer of its agency SHALL be left out of the artifacts, and the transform SHALL log the docket, its URL and the reason. A file whose agency record lacks an ID, a name or a state SHALL fail the transform, naming the file. The transform's last log line SHALL count cases written and dockets left out by reason.

#### Scenario: No party matches an officer

- **WHEN** none of a docket's parties matches an officer of the agency
- **THEN** no case is written for it
- **AND** the log names the docket, its URL and "no matching officer"

### Requirement: No document review outside the pipeline

The source SHALL NOT read or write a result produced by reviewing a document outside `data generate`.

#### Scenario: A leftover review file

- **WHEN** the source's state folder holds a `complaint-reviews/` folder
- **THEN** `data generate` does not read it
