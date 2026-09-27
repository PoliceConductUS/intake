## ADDED Requirements

### Requirement: Discipline identifies its person and issuing authority

Every Discipline MUST carry required personnel_id and licensing_authority_id
foreign keys and MAY carry document_url. MN POST MUST use the action contactId
and MN POST authority identity. It MUST NOT require or infer a license or
assignment attachment. Missing or unknown person identity MUST fail loudly.
Existing canonical discipline IDs and source names MUST remain unchanged.
Existing stored relationship rows MUST NOT be deleted.

#### Scenario: Person with two licenses has one disciplinary action

- **WHEN** an action identifies a known contact with two licenses
- **THEN** one action identifies the person and issuer without choosing a license
  or linking every current assignment

#### Scenario: Existing action receives its subject and issuer

- **WHEN** migration encounters an action with exactly one person and issuer
  through its existing assignment/license relationships
- **THEN** it fills the required foreign keys without replacing its ID
- **AND** an ambiguous or missing relationship fails migration

#### Scenario: Duplicate source entries describe one existing case

- **WHEN** entries share contactId and caseNumber and agree on substantive fields
- **THEN** the existing source name identifies one action and all raw entries
  and documents remain inspectable
- **AND** conflicting substantive fields or available document contents fail

### Requirement: Education completions attach to personnel

PersonnelEducation MUST store id, personnel_id, name, completion_date, credits,
sponsor_name, and sponsor_instructor. ID MUST resolve through the source-name
ledger using courseId. Personnel MUST resolve from contactId. Missing identity
or conflicting duplicate source IDs MUST fail loudly. Nullable source values
remain null. Education and discipline MUST be included when their personnel
is reached through an included agency, without pulling in another agency.
Course name MUST be nonblank. The source MUST omit unnamed completions and
report every omitted courseId and reason, preserving their raw source records.

#### Scenario: Education survives repeat import

- **WHEN** the same completion is imported again
- **THEN** its canonical ID is unchanged and supplied fields are compared
- **AND** changed fields update through the normal mutation pipeline

#### Scenario: Completion belongs to an unknown person

- **WHEN** a completion contactId does not identify source personnel
- **THEN** transform fails naming the completion and missing person

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

### Requirement: Chain bounded batches of record resolution

Shared graph selection and mutation generation MUST start record resolution in ordered batches, chaining each batch after the previous batch completes. Resolution within a batch MUST remain concurrent and use the existing lazy memoization and same-tick BatchLoader coalescing. A failed batch MUST reject the operation without starting subsequent batches. Record ordering, recurring-identity convergence, canonical IDs, field comparisons, and emitted mutation semantics MUST remain unchanged.

#### Scenario: A large kind resolves through chained batches

- **WHEN** one kind contains more records than one resolution batch
- **THEN** the next batch starts only after the preceding batch completes
- **AND** concurrent requests within each batch use the existing coalescer
- **AND** results retain source registration order regardless of completion order

#### Scenario: A failed batch stops admission

- **WHEN** a record resolution rejects
- **THEN** the operation rejects with that failure
- **AND** no subsequent batch starts
- **AND** no partial mutation envelope is reported as successful
