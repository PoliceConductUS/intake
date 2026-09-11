## ADDED Requirements

### Requirement: Acquire preserves and reads every disciplinary order document

The `sources/mn-post/acquire.ts` phase MUST download the document behind every
disciplinary action's `documentURL`, preserve it unchanged as
`documents/<stem>.pdf`, extract its text page by page (the embedded text
layer, or OCR of a page without one), have the text analyzed for what the
order says, and write one `documents/<stem>.document.json` per distinct
document URL carrying the URL, the citing actions, the PDF's sha256 and size,
the per-page text with its extraction method, the joined text, and the
analysis. A document the site no longer serves MUST be reported in the skip
report and MUST NOT produce a document record.

#### Scenario: an available order becomes a preserved PDF and a document record

- **WHEN** acquire fetches an action's document URL and receives a PDF
- **THEN** the PDF is written unchanged, its text extracted, its analysis
  produced, and a document record written keyed by the URL

#### Scenario: an unavailable order is reported, not fabricated

- **WHEN** the site returns 404, or a content-delivery page that serves no
  file, for an action's document URL
- **THEN** no PDF or document record is written and the skip report lists the
  URL, its citing actions, and the reason

#### Scenario: a resumed acquire re-does nothing already on disk

- **WHEN** acquire runs again with a document's PDF and record already present
- **THEN** it fetches, extracts, and analyzes nothing for that document

### Requirement: Extracted text and analysis are cached by document hash

Acquire MUST cache a document's extracted text and analysis in source state
keyed by the PDF's sha256, stamped with the analysis model and prompt version.
An unchanged document MUST NOT be re-extracted; it MUST be re-analyzed only
when the model or prompt version differs from the cached one.

#### Scenario: a fresh acquire reuses the cache for an unchanged document

- **WHEN** a fresh acquire downloads a document whose sha256 is cached
- **THEN** its document record is written from the cache without extracting or
  analyzing again

#### Scenario: a prompt-version change re-analyzes cached documents

- **WHEN** the analyzer's prompt version differs from the cached one
- **THEN** the cached text is reused and the document is analyzed again

### Requirement: Analysis reports the order in its own words

The analysis MUST return `allegation`, `violation`, `finding`, `chief_action`,
and `sanction`, each a string in the document's own words or null when the
document does not state it. It MUST fail loud on a refused or unparsable
response, and MUST require `ANTHROPIC_API_KEY` only when a document needs
analyzing.

#### Scenario: a cached-only run needs no API key

- **WHEN** every document's analysis is already cached
- **THEN** acquire completes without `ANTHROPIC_API_KEY`

#### Scenario: a new document without an API key fails loud

- **WHEN** a document needs analyzing and `ANTHROPIC_API_KEY` is unset
- **THEN** acquire fails naming the missing key

### Requirement: Discipline carries what its order says

The `discipline` table MUST have nullable `allegation`, `violation`,
`finding`, `chief_action`, and `sanction` columns, and the mn-post transform
MUST fill them on each `Discipline` record from the document record whose URL
matches the action's `documentURL`, null when there is no such record or the
field is null.

#### Scenario: an action with an analyzed document carries its fields

- **WHEN** the transform emits a Discipline for an action whose document
  record exists
- **THEN** the five order fields on the record equal the analysis

#### Scenario: an action with no document record carries nulls

- **WHEN** the transform emits a Discipline for an action with no document
  record
- **THEN** the five order fields are null
