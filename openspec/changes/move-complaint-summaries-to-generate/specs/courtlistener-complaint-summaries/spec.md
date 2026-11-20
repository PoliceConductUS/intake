## ADDED Requirements

### Requirement: The acquire only lists dockets

The CourtListener acquire SHALL search for each agency's dockets through the shared CourtListener client and write the `dockets.json` of each agency whose searches succeed, named by the agency's source ID. It SHALL NOT fetch docket entries, download a document or make a model call, and SHALL write no other file to its command folder.

#### Scenario: A full acquire

- **WHEN** the acquire runs for every agency and every search succeeds
- **THEN** the only requests it makes are searches, and each agency has one `dockets.json`

### Requirement: A failed search fails the acquire at its end

A search that finds nothing SHALL be a success. When a search for an agency fails, or is skipped because CourtListener is down, the acquire SHALL write no file for that agency, SHALL make every other search and write the other agencies' files, and SHALL then exit non-zero naming each failed or skipped search. Such an acquire SHALL NOT be recorded as completed.

#### Scenario: A search fails for one agency

- **WHEN** CourtListener answers one agency's search with an error for that search
- **THEN** that agency has no `dockets.json` and every other agency's file is written
- **AND** the acquire exits non-zero naming that search, and is not recorded as completed

#### Scenario: A search finds nothing

- **WHEN** an agency's searches find no docket
- **THEN** the agency's `dockets.json` holds an empty list of dockets and the acquire can complete

### Requirement: A civil case's complaint summary is worked out in generate

For a civil case whose primary source URL is a docket on `www.courtlistener.com`, `data generate` SHALL fetch the docket's entries, select the latest identified complaint, download its PDF, confirm it starts with `%PDF-`, compare its SHA-1 with the one CourtListener records when it records one, extract its text, and ask the model for a summary, each through the shared client for that service. The summary's source SHALL state whether the SHA-1 matched.

#### Scenario: A complaint that can be summarized

- **WHEN** a case's complaint is available, passes its checks and is summarized
- **THEN** the case carries the summary with the complaint's CourtListener page, its filing date and the model the service's response named
- **AND** the case's `complaint_file_id` points at the `BinaryFile` record of the file served, and the summary holds no file address or hash
- **AND** the summary's source states that the SHA-1 matched

#### Scenario: Nothing has changed since the last run

- **WHEN** `data generate` runs again and every call result for a case still stands
- **THEN** no request is made for that case and its summary is unchanged

#### Scenario: The prompt changes

- **WHEN** the summary prompt is changed
- **THEN** the next `data generate` asks the model again for each case and reuses the cached entries, PDF and text

### Requirement: The latest identified complaint is selected

Of the documents in a docket's entries that `ai-complaint-summary` identifies as a complaint, the resolver SHALL select the one in the entry with the highest entry number; within one entry, an explicitly labelled complaint attachment SHALL be selected first.

#### Scenario: An amended complaint filed later

- **WHEN** entry 1 holds a complaint and entry 20 holds an amended complaint
- **THEN** the amended complaint in entry 20 is selected, whether or not a copy of it is available

### Requirement: A case that is not a CourtListener docket keeps what its source supplied

For a civil case whose primary source URL is not a docket on `www.courtlistener.com`, `data generate` SHALL call no service for its complaint, SHALL keep the values its source supplied for `ai_complaint_summary` and `complaint_summary_unavailability`, and SHALL leave the annotations that resolvers reported in runs of other source namespaces as they are.

#### Scenario: A case from another source

- **WHEN** a case whose primary source URL is on another host is generated
- **THEN** no service is called, the case keeps the summary fields its source supplied, and the complaint annotations from CourtListener's runs stay active

### Requirement: A complaint problem does not keep the case out or stop the command

When a case's complaint cannot be summarized, `data generate` SHALL write the case with no summary and the unavailability state for the problem, SHALL report one finding of the type for the problem, and SHALL continue with the next record. The problems, their codes, states and types are the scenarios below. An error is a case where CourtListener's own data is wrong or contradicts itself. A warning is a case where something is absent or could not be used.

#### Scenario: The entries cannot be fetched

- **WHEN** the docket's entries cannot be fetched
- **THEN** the case is written with no summary and the `retrieval_failed` state, and carries a warning annotation with code `complaint-entries`

#### Scenario: No filing in the entries is a usable complaint

- **WHEN** the entries do not have the expected shape, or a complaint candidate in them has no entry number or a filing date that is not a date
- **THEN** the case is written with no summary and the `pending` state, and carries a warning annotation with code `complaint-entries-unusable`

#### Scenario: No complaint is identified

- **WHEN** no complaint is identified in the entries
- **THEN** the case is written with no summary and the `pending` state, and carries a warning annotation with code `complaint-not-found`

#### Scenario: A complaint with no free copy

- **WHEN** a case's identified complaint has no available copy, or no download address on `storage.courtlistener.com`
- **THEN** the case is written with no summary and the `missing_copy` state
- **AND** the case carries one warning annotation with code `complaint-no-copy`
- **AND** `data generate` goes on to the next record and exits zero

#### Scenario: The download fails

- **WHEN** the PDF cannot be downloaded
- **THEN** the case is written with no summary and the `retrieval_failed` state, and carries a warning annotation with code `complaint-download` whose value is the HTTP status, or null when the failure had none

#### Scenario: The served file is not a PDF

- **WHEN** the served file does not start with `%PDF-`
- **THEN** the case is written with no summary and the `retrieval_failed` state, and carries an error annotation with code `complaint-not-pdf`

#### Scenario: No text can be read

- **WHEN** the PDF tools cannot read the file, find no text on any page, or a PDF program runs past its time limit, is killed or overflows its output for that file
- **THEN** the case is written with no summary and the `available_unsummarized` state, and carries a warning annotation with code `complaint-no-text`

#### Scenario: No usable summary

- **WHEN** the model call ends in an item failure (a refusal, a stop before the end of the answer, an answer that is not JSON or does not fit the output schema, a response that names no model, or an API error other than 429 or 5xx), or the answer cites a page beyond the file's page count
- **THEN** the case is written with no summary and the `available_unsummarized` state, and carries a warning annotation with code `complaint-no-summary`

#### Scenario: The problem goes away

- **WHEN** a later `data generate` summarizes a complaint that had a problem
- **THEN** the case receives its summary and the annotation is resolved, keeping its ID

### Requirement: A complaint with no recorded SHA-1 is summarized and annotated

When CourtListener records no SHA-1 for the complaint's file, or one that is not 40 lower-case hex digits, `data generate` SHALL download the file, summarize its extracted text, and write the case with the summary, no unavailability state, and a summary source that states `sha1Verified: false`. It SHALL report one warning finding with code `complaint-no-check` on the case and SHALL continue with the next record.

#### Scenario: No recorded SHA-1

- **WHEN** CourtListener records no SHA-1 for the complaint's file
- **THEN** the case is written with a summary made from the served file, whose source states that the SHA-1 was not verified
- **AND** the case carries one warning annotation with code `complaint-no-check`, and no `complaint-mismatch` annotation

#### Scenario: No recorded SHA-1 and no text

- **WHEN** CourtListener records no SHA-1 and no text can be extracted from the file
- **THEN** the case is written with no summary, the `available_unsummarized` state, the `complaint-no-check` annotation and the `complaint-no-text` annotation

### Requirement: A complaint whose file does not match its recorded SHA-1 is summarized and annotated

When a downloaded PDF's SHA-1 differs from the one CourtListener records, `data generate` SHALL keep the served file as a `BinaryFile` record that the case points at, summarize its extracted text, and write the case with the summary and no unavailability state. The summary's source SHALL state that the SHA-1 did not match. `data generate` SHALL report one error finding with code `complaint-mismatch` on the case and SHALL continue with the next record.

#### Scenario: The served file does not match the recorded SHA-1

- **WHEN** a downloaded PDF's SHA-1 differs from the one CourtListener records
- **THEN** the case is written with a summary made from the served file, whose source states that the SHA-1 did not match
- **AND** the case carries one error annotation whose value holds the recorded SHA-1, the served file's SHA-1 and SHA-256, and its byte count
- **AND** the case's `complaint_file_id` points at the served file's `BinaryFile` record, whose SHA-256 is the served file's
- **AND** `data generate` continues and exits zero

#### Scenario: A mismatched file that cannot be summarized

- **WHEN** a downloaded PDF does not match its recorded SHA-1 and no text can be extracted from it
- **THEN** the case is written with no summary, the `available_unsummarized` state, the `complaint-mismatch` annotation and the `complaint-no-text` annotation

#### Scenario: The file later matches

- **WHEN** a refreshed entries result records a SHA-1 that equals the file already kept, or gives a different file address whose downloaded file matches its recorded SHA-1
- **THEN** the case's summary is made from that file and the `complaint-mismatch` annotation is resolved, keeping its ID

### Requirement: An outage during generate leaves a case as it was

When a service a case's complaint needs is down during `data generate`, the case SHALL keep the summary and unavailability state it had, SHALL receive no new annotation, and SHALL be processed on a later run: the next one, or, for the case whose call found the outage, the first after the outage's wait. `data generate` SHALL continue, print the skip lines and exit zero; only `data acquire` fails at its end on skipped calls.

#### Scenario: The model service goes down partway through

- **WHEN** the inference service stops answering after some cases are summarized
- **THEN** the remaining cases keep their existing summary fields and annotations unchanged
- **AND** a later `data generate`, with the service back, summarizes them

### Requirement: A problem is tried again when its call result says so

A complaint problem SHALL be tried again only when the cached call result behind it no longer stands: its `retryAfter` has passed, or the request has changed.

#### Scenario: A download that failed for one document

- **WHEN** a download answered 404 and `data generate` runs again within 24 hours
- **THEN** no request is made for that file and the case keeps its state and annotation

#### Scenario: The docket's entries are refreshed

- **WHEN** the entries call result's `retryAfter` has passed and the new entries identify an available complaint
- **THEN** the complaint is downloaded and summarized

### Requirement: Entries are refreshed after 120 days and item failures after 24 hours

A successful entries result SHALL carry a `retryAfter` 120 days after it was made, and every item failure one 24 hours after it. A successful download, text extraction or model answer SHALL carry none, so it stands until its request changes or the stored result is retired through the `intake cache` retire operation. During `data reset --no-acquire` a successful result stands even after its `retryAfter`.

#### Scenario: A model refusal

- **WHEN** the model refused to summarize a complaint and `data generate` runs again within 24 hours with the same prompt and text
- **THEN** no request is made and the case keeps its `complaint-no-summary` annotation

### Requirement: Intake writes the annotation's reader-facing text

Each complaint finding's message SHALL be the text its scenario below gives, with the addresses filled in, and nothing more: that we tried to summarize the complaint, why we could not, and where to look. The `complaint-mismatch` and `complaint-no-check` messages say instead that a summary was made, why it should not be trusted or could not be checked, and where to look.

#### Scenario: Message for `complaint-entries`

- **WHEN** a finding's code is `complaint-entries`
- **THEN** its message is "We could not summarize the complaint in this case because we could not get the list of documents filed in it. The case on CourtListener: `<docket>`"

#### Scenario: Message for `complaint-entries-unusable`

- **WHEN** a finding's code is `complaint-entries-unusable`
- **THEN** its message is "We could not summarize the complaint in this case because the list of documents filed in it does not show clearly which document is the complaint or when it was filed. The case on CourtListener: `<docket>`"

#### Scenario: Message for `complaint-not-found`

- **WHEN** a finding's code is `complaint-not-found`
- **THEN** its message is "We could not summarize the complaint in this case because we could not find it among the documents filed. The case on CourtListener: `<docket>`"

#### Scenario: Message for `complaint-no-copy`

- **WHEN** a finding's code is `complaint-no-copy`
- **THEN** its message is "We could not summarize the complaint in this case because a free copy of it is not available. The case on CourtListener: `<docket>` You can help: if you buy the complaint from PACER with the free RECAP browser extension installed, it becomes free for everyone on CourtListener. How to set that up: https://free.law/recap/"

#### Scenario: Message for `complaint-download`

- **WHEN** a finding's code is `complaint-download`
- **THEN** its message is "We could not summarize the complaint in this case because we could not download it. The complaint: `<complaint>`"

#### Scenario: Message for `complaint-no-check`

- **WHEN** a finding's code is `complaint-no-check`
- **THEN** its message is "The summary of the complaint in this case was made from a copy that we could not check, because CourtListener does not record what the file should contain. The complaint: `<complaint>`"
- **AND** the message does not contain "SHA-1"

#### Scenario: Message for `complaint-mismatch`

- **WHEN** a finding's code is `complaint-mismatch`
- **THEN** its message is "The summary of the complaint in this case was made from a copy that is not the file CourtListener has on record. Do not trust the summary, or anything else on this page that was worked out from that copy. The complaint: `<complaint>`"
- **AND** the message does not contain "SHA-1"

#### Scenario: Message for `complaint-not-pdf`

- **WHEN** a finding's code is `complaint-not-pdf`
- **THEN** its message is "We could not summarize the complaint in this case because the file could not be opened. The complaint: `<complaint>`"

#### Scenario: Message for `complaint-no-text`

- **WHEN** a finding's code is `complaint-no-text`
- **THEN** its message is "We could not summarize the complaint in this case because its text could not be read. The complaint: `<complaint>`"

#### Scenario: Message for `complaint-no-summary`

- **WHEN** a finding's code is `complaint-no-summary`
- **THEN** its message is "We tried to summarize the complaint in this case and could not. The complaint: `<complaint>`"

### Requirement: A message gives only CourtListener page addresses

In a complaint finding's message, `<docket>` SHALL be the docket's full URL on `www.courtlistener.com`, and `<complaint>` SHALL be the full URL of the complaint document's page on `www.courtlistener.com`, or the docket's URL when the complaint has no such page. Apart from `https://free.law/recap/`, a message SHALL NOT give an address on any other host. The unavailability state's source URL SHALL be the address the message gives.

#### Scenario: The complaint has no page of its own

- **WHEN** a complaint cannot be downloaded and has no CourtListener page
- **THEN** the `complaint-download` message and the state's source URL give the docket's address

### Requirement: An annotation's evidence names its sources

A complaint finding's evidence SHALL hold one source record for the docket, one for the complaint document when one is identified, and one for the downloaded file when there is one. Each SHALL state what it is (`docket`, `complaint document` or `downloaded file`), the source namespace and its full URL. The downloaded file's record SHALL also hold the time it was retrieved and its SHA-256.

#### Scenario: Evidence for a mismatched file

- **WHEN** a downloaded PDF does not match its recorded SHA-1
- **THEN** the evidence holds a docket source, a complaint document source, and a downloaded file source with the download URL, the time and the served file's SHA-256

### Requirement: A docket that names an officer but cannot build a case is annotated on the licensing authority

When a docket has a party who matches an officer of its agency but has no title, or no filing date that starts with `YYYY-MM-DD`, the transform SHALL write no case for it and SHALL report a warning finding with code `docket-not-buildable` on the licensing authority of the agency's state, with the docket as the finding's source record. A docket found for two agencies of one state SHALL be reported once.

#### Scenario: The finding's content

- **WHEN** a docket naming an officer of an agency lacks a title, a filing date, or both
- **THEN** the finding's field is `civil_cases`, its value holds the docket's `case_name` and `date_filed` as CourtListener gave them, and its evidence holds the docket's URL
- **AND** its message is "A court case naming an officer of `<agency name>` is not shown on this site because CourtListener, a free website of court records, lists it without `<a title | a filing date | a title and a filing date>`. You can see the case here: `<address>`"

#### Scenario: A state with no licensing authority

- **WHEN** the transform processed an agency in a state that has no licensing authority
- **THEN** `data generate` fails naming the selector; the manual source gives every state an agency is in a licensing authority, so this happens only before that record is added

#### Scenario: Two such dockets in one state

- **WHEN** two Texas dockets each lack a filing date
- **THEN** the Texas licensing authority carries two warning annotations, one per docket

#### Scenario: The last such docket is fixed

- **WHEN** a later transform finds no such docket for Texas
- **THEN** the Texas licensing authority record is still emitted with an empty list and the earlier annotations are resolved

### Requirement: A docket left out for want of an officer is logged

A docket with no party who matches an officer of its agency SHALL be left out of the artifacts, and the transform SHALL log the docket, its URL and the reason. A file whose agency record lacks an ID, a name or a state, or that has no list of dockets, SHALL fail the transform, naming the file. The transform's last log line SHALL count cases written and dockets left out by reason.

#### Scenario: No party matches an officer

- **WHEN** none of a docket's parties matches an officer of the agency
- **THEN** no case is written for it
- **AND** the log names the docket, its URL and "no matching officer"

### Requirement: No document review outside the pipeline

The source SHALL NOT read or write a result produced by reviewing a document outside `data generate`.

#### Scenario: A leftover review file

- **WHEN** the source's state folder holds a `complaint-reviews/` folder
- **THEN** `data generate` does not read it
