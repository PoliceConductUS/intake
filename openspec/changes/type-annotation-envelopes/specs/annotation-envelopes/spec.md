## ADDED Requirements

### Requirement: An annotation is a typed envelope

An annotation SHALL be an intake envelope with `apiVersion: policeconduct.org/intake/v1alpha1`, a `kind`, `metadata` and a strict `spec`, read and written only through canonical IO. An annotation SHALL name its annotation kind, which says what sort of annotation it is. Each annotation kind SHALL have its own strict schema, and an annotation SHALL be checked against the schema of the annotation kind it names.

#### Scenario: An unknown key is rejected

- **WHEN** an annotation holds a key its annotation kind does not declare
- **THEN** the read fails naming the key

#### Scenario: An annotation that does not match its annotation kind is rejected

- **WHEN** an annotation is valid for one annotation kind but names another
- **THEN** the read fails

### Requirement: An annotation carries sources

An annotation SHALL carry a list of sources, and each source SHALL state whether it is a public source or an intake reference. A public source SHALL state what it is and its full `http` or `https` URL, with the retrieval time and SHA-256 when its URL is a file intake retained. An intake reference SHALL pinpoint the retained material it points at, and SHALL name the part of a file (such as a sheet and row) when it points at part of one.

#### Scenario: A complaint that failed verification

- **WHEN** an annotation records a complaint PDF that did not match its recorded SHA-1
- **THEN** its sources hold a public source for the complaint's page on CourtListener and an intake reference to the retained PDF

#### Scenario: A workbook row is kept

- **WHEN** a finding comes from one row of one sheet of a source workbook
- **THEN** its intake reference names that sheet and row

#### Scenario: A public source without a web address is rejected

- **WHEN** a public source's URL does not use `http` or `https`
- **THEN** the read fails naming the URL field

#### Scenario: A source that does not say which sort it is is rejected

- **WHEN** a source does not state whether it is a public source or an intake reference
- **THEN** the read fails

### Requirement: An intake reference stays in intake

An intake reference SHALL NOT appear on any policeconduct.org page or download, including the default rendering and the CSV.

#### Scenario: The listing of a complaint that failed verification

- **WHEN** the data-annotations listing and its CSV are built for an annotation with a public source and an intake reference
- **THEN** they show the public source and not the intake reference

### Requirement: The message is plain English kept in one place

An annotation's message SHALL be plain reader-facing text written by intake, in words a typical site visitor knows and would use correctly, and SHALL NOT hold markup. An annotation SHALL refer to its wording by a message code, and each message code SHALL resolve to one wording that intake owns.

#### Scenario: Wording is changed once

- **WHEN** the wording for a message code is changed
- **THEN** every annotation with that code shows the new wording after the next site build that includes the change

#### Scenario: Source text contains markup characters

- **WHEN** a message quotes a case name containing `<` or `*`
- **THEN** policeconduct.org shows those characters as written

### Requirement: The annotation record names its kind

The annotation row in the database SHALL hold the annotation's kind. Intake SHALL publish each annotation kind's schema in the annotation contract that `scripts/publish-data-annotation-contract.ts` writes for policeconduct.org. The kind SHALL be distinct from the row's `type`, which SHALL keep its values of warning, error and correction.

#### Scenario: A stored annotation

- **WHEN** an annotation of a given kind is imported
- **THEN** its database row holds that kind

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

A record page on policeconduct.org SHALL show only an annotation's label and message. During static generation of the data-annotations listings, including those of a licensing authority, policeconduct.org SHALL look up a component for the annotation's kind and use it when one exists. When none exists it SHALL use a default renderer that shows the annotation's kind-specific fields as preformatted JSON, without intake references.

#### Scenario: A record page

- **WHEN** a record page is built for a record with an annotation
- **THEN** it shows the annotation's label and message and nothing else of it

#### Scenario: A kind with a component

- **WHEN** a data-annotations listing is built for an annotation whose kind has a component
- **THEN** that component renders it

#### Scenario: A kind with no component

- **WHEN** intake adds an annotation kind and policeconduct.org has no component for it
- **THEN** the listing shows the default rendering with no intake reference, and the build does not fail
