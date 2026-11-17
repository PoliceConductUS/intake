## ADDED Requirements

### Requirement: Acquire keeps every disciplinary order document in the cache

The `sources/com/site/my/mnitservices/post-license-search/acquire.ts` phase MUST download the document behind every disciplinary action's `documentURL` through the shared file download client, which preserves it unchanged in the cache as a binary file. It MUST write one document reference per distinct document URL carrying the URL, the citing actions and the binary file's SHA-256 and size. It MUST NOT write the PDF into the command folder, extract text or request an analysis. A document the site no longer serves MUST be reported in the skip report and MUST NOT produce a document reference.

#### Scenario: an available order becomes a binary file and a document reference

- **WHEN** acquire fetches an action's document URL and receives a PDF
- **THEN** the PDF is in the cache unchanged and a document reference is written keyed by the URL

#### Scenario: an unavailable order is reported, not fabricated

- **WHEN** the site returns 404, or a content-delivery page that serves no file, for an action's document URL
- **THEN** no binary file or document reference is written and the skip report lists the URL, its citing actions, and the reason

#### Scenario: a later acquire downloads nothing already cached

- **WHEN** acquire runs again and the download's call result for a document URL still stands
- **THEN** it makes no request for that document

### Requirement: Order text and analysis are call results made in generate

`data generate` MUST extract a document's text and request its analysis through the shared clients, which cache each as a call result whose request includes the PDF's SHA-256 and, for the analysis, the model, its parameters and the prompt text. An unchanged document MUST NOT be extracted again; it MUST be analyzed again only when the model, its parameters or the prompt differ.

#### Scenario: an unchanged document makes no call

- **WHEN** `data generate` processes a document whose text and analysis call results stand
- **THEN** it extracts and analyzes nothing

#### Scenario: a prompt change re-analyzes cached documents

- **WHEN** the analysis prompt differs from the one in the cached request
- **THEN** the cached text is reused and the document is analyzed again

### Requirement: Order analysis reports the order in its own words

The analysis MUST return `allegation`, `violation`, `finding`, `chief_action`, and `sanction`, each a string in the document's own words or null when the document does not state it. A refused or unparsable response MUST be recorded as a failed call result and reported as a finding on the discipline record, and MUST NOT stop the command. The analysis MUST need `ANTHROPIC_API_KEY` only when a document needs analyzing. A result produced by a document review before this change MUST be kept as a call result whose outcome says a document review produced it; no new reviewed result is accepted.

#### Scenario: a cached-only run needs no API key

- **WHEN** every document's analysis call result stands
- **THEN** `data generate` completes without reading `ANTHROPIC_API_KEY`

#### Scenario: a new document without an API key fails loud

- **WHEN** a document needs analyzing and the key cannot be read from Parameter Store
- **THEN** `data generate` fails naming the parameter

#### Scenario: a refused analysis does not stop the command

- **WHEN** the model refuses to analyze one document
- **THEN** the discipline record is written without the analysis fields and carries a warning annotation, and the command continues

## REMOVED Requirements

### Requirement: Acquire preserves and reads every disciplinary order document

**Reason**: The order PDF is kept in the cache as a binary file, not in the command folder, and text extraction and analysis move to `data generate`.

**Migration**: Replaced by "Acquire keeps every disciplinary order document in the cache". `intake cache migrate` moves existing PDFs.

### Requirement: Extracted text and analysis are cached by document hash

**Reason**: The source-owned `documents/` cache is removed; text and analysis are call results in the shared cache.

**Migration**: Replaced by "Order text and analysis are call results made in generate". `intake cache migrate` moves existing text and analyses.

### Requirement: Analysis reports the order in its own words

**Reason**: A refused analysis no longer stops the command, and a hand-reviewed result is no longer accepted as new input.

**Migration**: Replaced by "Order analysis reports the order in its own words". Existing reviewed results are kept as call results that say a document review produced them.
