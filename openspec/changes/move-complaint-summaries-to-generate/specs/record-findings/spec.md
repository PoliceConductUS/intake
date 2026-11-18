## ADDED Requirements

### Requirement: A finding describes one problem with one source record

A finding SHALL have a code, a type of warning or error, a field, a value, a plain-English message, the source namespace and the source record ID it is about, and MAY have evidence. The code SHALL name the sort of problem and SHALL NOT change when the message's wording changes.

#### Scenario: A finding with no code

- **WHEN** a finding has no code
- **THEN** reading it fails naming the missing field

### Requirement: A source reports findings in a record's metadata

A record in an artifact MAY carry a list of findings as `metadata.defects`. A finding's source record ID MAY differ from the record's own. A record's metadata SHALL be validated once against its strict schema and SHALL then be passed from the transform to the import as one object.

#### Scenario: Metadata reaches the import whole

- **WHEN** a transform emits a record whose metadata holds `defects`
- **THEN** the import receives the same list

#### Scenario: An unknown metadata key

- **WHEN** a record's metadata holds a key its schema does not declare
- **THEN** reading the artifact fails naming the key

### Requirement: A resolver reports a finding without stopping the command

A resolver MAY report a finding about the record it is resolving and return no value. The command SHALL continue with the next record.

#### Scenario: A resolver cannot fill a field

- **WHEN** a resolver reports a warning finding and returns no value
- **THEN** the record is written without that field's value and the command continues

### Requirement: Each finding becomes one annotation with a stable ID

`data generate` SHALL write each reported finding as an active annotation of the finding's type on the record that carried or reported it. The annotation's identity SHALL be derived from the subject record, whether a source or a resolver reported it, the finding's code and field, and the finding's source namespace and source record ID. The same finding SHALL have the same annotation ID on every run, and two findings that differ in any of those SHALL be two annotations.

#### Scenario: Two dockets, one record, one code

- **WHEN** one licensing authority record carries two findings with the same code about two dockets
- **THEN** two annotations are written, one per docket

#### Scenario: The same finding on a later run

- **WHEN** `data generate` runs again and the same finding is reported
- **THEN** no new annotation is written and the existing one keeps its ID

### Requirement: A finding that is no longer reported is resolved

When a record is emitted again and a finding reported for it earlier is not reported, `data generate` SHALL write that finding's annotation as resolved, keeping its ID. A source that reports findings on a record SHALL emit that record whenever it runs, with an empty list when it has none.

#### Scenario: The problem is fixed

- **WHEN** a record that carried a finding is emitted without it
- **THEN** the annotation's status becomes resolved and its ID is unchanged

### Requirement: A resolver that could not decide keeps its earlier findings

A resolver that cannot work out its result on a run, because a service it needs went down during the run, MAY state that the findings reported by the record's resolvers on earlier runs are kept. `data generate` SHALL then write none of those annotations as resolved on that run.

#### Scenario: A service goes down

- **WHEN** a record's resolver reported a finding on an earlier run, and on this run it states that earlier findings are kept and reports nothing
- **THEN** the annotation stays active with its ID unchanged

### Requirement: A source's findings are resolved only by that source

The identity of a source finding's annotation SHALL also include the source namespace of the artifact that carried the record. A source finding SHALL be resolved only by a record from the same source namespace whose metadata holds `defects`, which MAY be an empty list. A record whose metadata holds no `defects` SHALL leave earlier source findings on its subject record as they are.

#### Scenario: A record with no defects list

- **WHEN** a record that carried a finding is emitted with no `defects` in its metadata
- **THEN** the annotation stays active

#### Scenario: Two sources report on one record

- **WHEN** source A and source B have each reported a finding on the same licensing authority, and source A emits that record again with an empty `defects` list
- **THEN** source A's annotation becomes resolved, and source B's annotation stays active with its ID unchanged

### Requirement: A finding on a kind that cannot hold annotations fails

A finding reported for a record whose kind does not take part in annotations SHALL fail `data generate`, naming the kind.

#### Scenario: A kind without source evidence

- **WHEN** a record of a kind with no source evidence carries a finding
- **THEN** `data generate` exits non-zero naming the kind
