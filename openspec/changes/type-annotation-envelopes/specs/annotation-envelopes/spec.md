## ADDED Requirements

### Requirement: An annotation names its kind and is checked against it

Every annotation SHALL be one `DataAnnotation` record, read and written only through canonical IO, whose row holds its annotation kind (what sort of annotation it is) and a payload. Each annotation kind SHALL have its own strict schema, and every create or update of an annotation SHALL check the whole resulting record against the schema of the kind it names. The first kinds SHALL be `general` and `excluded-record`.

#### Scenario: The kind is not the type

- **WHEN** an annotation of kind `general` is a warning
- **THEN** its row holds `kind` `general` and `type` `warning`, and `type` keeps its values of warning, error and correction

#### Scenario: An unknown key is rejected

- **WHEN** an annotation's payload holds a key its kind does not declare
- **THEN** the read fails naming the key

#### Scenario: An update that breaks the kind's schema is rejected

- **WHEN** an update to an annotation would leave a payload that does not match the schema of the kind it names
- **THEN** the update fails

### Requirement: An annotation carries sources a reader can open

An annotation's payload SHALL hold a list of sources, and each source SHALL state which sort it is. A public source SHALL state what it is and its full `http` or `https` URL. A file source SHALL point at the file's `BinaryFile` record through the annotation's `binary_file_id` foreign key, SHALL name the part of the file it means (such as a sheet and row, or a page), and SHALL show the source's own URL as its public part when the source has one. An annotation SHALL have at most one file source.

#### Scenario: A complaint that failed verification

- **WHEN** an annotation records a complaint PDF that did not match its recorded SHA-1
- **THEN** its sources hold a public source for the docket and a file source pointing at the PDF's `BinaryFile` record, whose public part is the complaint's page on CourtListener

#### Scenario: A workbook row is kept

- **WHEN** a finding comes from one row of one sheet of a source workbook
- **THEN** its file source points at the workbook's `BinaryFile` record and names that sheet and row

#### Scenario: A public source without a web address is rejected

- **WHEN** a public source's URL does not use `http` or `https`
- **THEN** the read fails naming the URL field

#### Scenario: A source that does not say which sort it is is rejected

- **WHEN** a source does not state which sort it is
- **THEN** the read fails

### Requirement: Audit references stay out of the database

Intake's internal audit references (the command, a workspace path, a source ID) SHALL be kept only in the transform output and in the chain entry beside the annotation's mutation. The `data_annotation` row, the published annotation contract and policeconduct.org SHALL NOT hold them.

#### Scenario: An annotation applied to the database

- **WHEN** an annotation whose transform output holds an audit reference is applied with `data up`
- **THEN** its database row holds no audit reference
- **AND** the chain entry holds it beside the annotation's mutation

### Requirement: The message is a template kept in one place

An annotation SHALL refer through its `message_id` foreign key to the record of its message code, and SHALL hold the named values that message's template uses. Each message code's wording SHALL be a `DataAnnotationMessage` record (the record kind for one message code's wording) holding a plain-English template with no markup, written by intake from one checked-in catalogue. No value SHALL depend on the time of the run.

#### Scenario: A value contains markup characters

- **WHEN** an annotation's value is a case name containing `<` or `*`
- **THEN** policeconduct.org shows those characters as written

### Requirement: The shared import writes the messages it uses

In every `data generate`, `DataContext` SHALL emit the `DataAnnotationMessage` record of each message code its annotations use, under namespace `intake`, in the same mutation as those annotations. `data generate` SHALL fail when a template names a value its annotation lacks, when an annotation holds a value its template does not name, or when a message code is not in the catalogue.

#### Scenario: Wording is changed once

- **WHEN** the wording for a message code is changed in the catalogue and `data generate` runs
- **THEN** it writes one update to that message's record and no update to the annotations that use it

#### Scenario: A template names a missing value

- **WHEN** an annotation lacks a value its message's template names
- **THEN** `data generate` fails naming the code and the value

### Requirement: The annotation contract is published

Intake SHALL publish each annotation kind's schema and the shape of the message records in the annotation contract that `scripts/publish-data-annotation-contract.ts` writes for policeconduct.org.

#### Scenario: The schema is published

- **WHEN** the annotation contract is published
- **THEN** it holds the schema of every annotation kind intake can write

### Requirement: An annotation keeps its ID

Moving an annotation to the new shape SHALL NOT change its ID. `DataContext` SHALL keep naming an annotation and resolving its ID as the requirement "An annotation's name does not change" states. A manual annotation SHALL keep the ID it has.

#### Scenario: The rebuild in the new shape

- **WHEN** the database is rebuilt in the new shape with `data reset --no-acquire`
- **THEN** the set of annotation IDs, active and resolved, equals the set saved from the database it replaces
- **AND** the check fails naming every ID that differs

#### Scenario: Unchanged findings write nothing

- **WHEN** `data generate` runs, its mutations are applied with `data up`, and `data generate` runs again with unchanged findings
- **THEN** the second run writes no annotation mutation

### Requirement: An annotation's name does not change

`DataContext` SHALL name an annotation as it does today: the hex SHA-256 of `JSON.stringify([subject kind, subject identity, ...owner])`, then `/`, then the hex SHA-256 of `JSON.stringify([key, source_namespace, source_record_id])`, where the owner and the key (a JSON string) are those its finding group gives today. It SHALL resolve the ID through the source-name mapping under namespace `intake` and kind `DataAnnotation`.

#### Scenario: A source finding's name

- **WHEN** a source finding with a code and field is turned into an annotation in the new shape
- **THEN** its name equals the name the flat shape gave it

### Requirement: The website renders an annotation by its kind

A record page on policeconduct.org SHALL show only an annotation's label and message. During static generation of the data-annotations listings, including those of a licensing authority, policeconduct.org SHALL look up a component for the annotation's kind and use it when one exists. When none exists it SHALL use a default renderer that shows the annotation's payload as preformatted JSON.

#### Scenario: A record page

- **WHEN** a record page is built for a record with an annotation
- **THEN** it shows the annotation's label and message and nothing else of it

#### Scenario: A kind with a component

- **WHEN** a data-annotations listing is built for an annotation whose kind has a component
- **THEN** that component renders it

#### Scenario: A kind with no component

- **WHEN** intake adds an annotation kind and policeconduct.org has no component for it
- **THEN** the listing shows the default rendering, and the build does not fail
