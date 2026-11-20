## ADDED Requirements

### Requirement: Acquire keeps every disciplinary order document in the cache

The Minnesota POST acquire MUST download the document behind every disciplinary action's `documentURL` through the shared file download client, which stores it unchanged under the Minnesota namespace and records the download as a call entry of the cache, and MUST also save it in the command folder. It MUST write one document reference per distinct document URL carrying the URL, the citing actions and the file's SHA-256 and size. It MUST NOT extract text or request an analysis.

#### Scenario: an available order becomes a binary file and a document reference

- **WHEN** acquire fetches an action's document URL and receives a PDF
- **THEN** the PDF is stored unchanged, its download is in the cache, and a document reference is written keyed by the URL

#### Scenario: a later acquire downloads nothing already cached

- **WHEN** acquire runs again and the download's call entry for a document URL still stands
- **THEN** it makes no request for that document

### Requirement: An order the site no longer serves is reported

A document the site no longer serves MUST be reported in the skip report and MUST NOT produce a document reference.

#### Scenario: an unavailable order is reported, not fabricated

- **WHEN** the site returns 404, or a content-delivery page that serves no file, for an action's document URL
- **THEN** no document reference is written and the skip report lists the URL, its citing actions, and the reason
- **AND** the download's call entry records the failure, with a `retryAfter`, as the evidence of what was served

### Requirement: Order text and analysis are call results made in generate

`data generate` MUST extract a document's text and request its analysis through the shared clients, which cache each as a call entry of the resolved-property cache under the order's `BinaryFile` record: the text extraction's request includes the PDF's SHA-256, and the analysis request includes the SHA-256 of the text sent, the parameters and the prompt text. The request MUST NOT include the model; the analysis outcome records the model asked for and the model that answered.

#### Scenario: a model change re-analyzes nothing

- **WHEN** the analysis model differs from the one a cached outcome was asked for
- **THEN** the cached analysis is used and no call is made

### Requirement: A cached order is not extracted or analyzed again

An unchanged document MUST NOT be extracted again; it MUST be analyzed again only when the parameters or the prompt differ, and not when the model does.

#### Scenario: an unchanged document makes no call

- **WHEN** `data generate` processes a document whose text and analysis call entries stand
- **THEN** it extracts and analyzes nothing

#### Scenario: a prompt change re-analyzes cached documents

- **WHEN** the analysis prompt differs from the one in the cached request
- **THEN** the cached text is reused and the document is analyzed again

### Requirement: Order analysis reports the order in its own words

The analysis MUST return `allegation`, `violation`, `finding`, `chief_action`, and `sanction`, each a string in the document's own words or null when the document does not state it. A refused or unparsable response MUST be recorded as a failed outcome and reported as a finding on the discipline record, and MUST NOT stop the command.

#### Scenario: a refused analysis does not stop the command

- **WHEN** the model refuses to analyze one document
- **THEN** the discipline record is written without the analysis fields and carries a warning annotation, and the command continues

### Requirement: A reviewed analysis is kept and no new one is accepted

A result produced by a document review before this change MUST be kept as a call entry whose outcome says a document review produced it, with its `absenceReasons` and `reviewReceipt` evidence in the answer; no new reviewed result is accepted.

#### Scenario: a reviewed analysis in the cache

- **WHEN** a Minnesota analysis was produced by a document review and not by the model
- **THEN** its outcome says a document review produced it and does not name the review as the model

#### Scenario: a new reviewed result

- **WHEN** a reviewed result is offered for a document after this change
- **THEN** it is not accepted as input

### Requirement: The analysis key is read only when a document needs analyzing

The analysis MUST need `ANTHROPIC_API_KEY` only when a document needs analyzing.

#### Scenario: a cached-only run needs no API key

- **WHEN** every document's analysis call entry stands
- **THEN** `data generate` completes without reading `ANTHROPIC_API_KEY`

#### Scenario: a new document without an API key fails loud

- **WHEN** a document needs analyzing and the key cannot be read from Parameter Store
- **THEN** `data generate` fails naming the parameter

## MODIFIED Requirements

### Requirement: Discipline carries what its order says

The `discipline` table MUST have nullable `allegation`, `violation`, `finding`, `chief_action`, and `sanction` columns. `data generate` MUST fill them on each `Discipline` record from the analysis of the order document whose URL matches the action's `documentURL`, null when there is no such document, when the field is null, or when the analysis failed.

#### Scenario: an action with an analyzed document carries its fields

- **WHEN** `data generate` resolves a Discipline for an action whose document has an analysis
- **THEN** the five order fields on the record equal the analysis

#### Scenario: an action with no document record carries nulls

- **WHEN** `data generate` resolves a Discipline for an action with no document reference
- **THEN** the five order fields are null

## REMOVED Requirements

### Requirement: Acquire preserves and reads every disciplinary order document

**Reason**: The order PDF is stored by namespace and its download recorded in the cache, as well as saved in the command folder, and text extraction and analysis move to `data generate`.

**Migration**: Replaced by "Acquire keeps every disciplinary order document in the cache" and "An order the site no longer serves is reported". The one-time workspace move described in the `cache-call-results-and-files` design moves existing PDFs; it is a script, not an intake command.

### Requirement: Extracted text and analysis are cached by document hash

**Reason**: The source-owned `documents/` cache is removed; text and analysis are call entries in the resolved-property cache.

**Migration**: Replaced by "Order text and analysis are call results made in generate". The same one-time move carries over the page text and analyses in the `*.document.json` files of the command folders.

### Requirement: Analysis reports the order in its own words

**Reason**: A refused analysis no longer stops the command, and a hand-reviewed result is no longer accepted as new input.

**Migration**: Replaced by "Order analysis reports the order in its own words" and "The analysis key is read only when a document needs analyzing". Existing reviewed results are kept as call entries that say a document review produced them.
