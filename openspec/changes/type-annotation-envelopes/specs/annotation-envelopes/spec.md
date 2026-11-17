## ADDED Requirements

### Requirement: An annotation is a typed envelope

Each kind of annotation SHALL be an intake envelope with `apiVersion: policeconduct.org/intake/v1alpha1`, its own `kind`, `metadata` and a strict `spec`, read and written only through that kind's canonical IO.

#### Scenario: An unknown key is rejected

- **WHEN** an annotation envelope's `spec` holds a key its kind does not declare
- **THEN** the read fails naming the key

### Requirement: An annotation carries sources

An annotation's `spec` SHALL hold a list of sources. A public source SHALL state what it is and its full `http` or `https` URL, with the retrieval time and SHA-256 when intake retrieved it. An intake reference SHALL state `commandId`, `namespace`, `kind`, `sourceId` and a `location` holding a `base` of `command-folder` or `state-folder`, a path relative to that base, a media type and a SHA-256. An intake reference SHALL NOT be shown in the policeconduct.org UI.

#### Scenario: A complaint that failed verification

- **WHEN** an annotation records a complaint PDF that did not match its recorded SHA-1
- **THEN** its sources hold a public source for the docket entry and an intake reference to the retained PDF with a `state-folder` base
- **AND** the page for that case shows the public source and not the intake reference

### Requirement: The message is plain English kept in one place

An annotation's message SHALL be plain reader-facing text written by intake, in words a typical site visitor knows and would use correctly, and SHALL NOT hold markup. The annotation row SHALL hold a message code that is a foreign key to a table of messages intake owns.

#### Scenario: Wording is changed once

- **WHEN** the wording for a message code is changed in the messages table
- **THEN** every annotation with that code shows the new wording after the next site build

#### Scenario: Source text contains markup characters

- **WHEN** a message quotes a case name containing `<` or `*`
- **THEN** policeconduct.org shows those characters as written

### Requirement: The annotation record names its kind

The annotation row in the database SHALL hold the annotation's kind, and intake SHALL publish each kind's schema. The kind SHALL be distinct from the row's `type`, which SHALL keep its values of warning, error and correction.

#### Scenario: A stored annotation

- **WHEN** an annotation of a given kind is imported
- **THEN** its database row holds that kind

### Requirement: The website renders an annotation by its kind

During static generation policeconduct.org SHALL look up a component for the annotation's kind and use it when one exists. When none exists it SHALL use a default renderer that shows parts of the record as preformatted JSON.

#### Scenario: A kind with a component

- **WHEN** a page is built for an annotation whose kind has a component
- **THEN** that component renders it

#### Scenario: A kind with no component

- **WHEN** intake adds an annotation kind and policeconduct.org has no component for it
- **THEN** the page shows the default rendering, and the build does not fail
