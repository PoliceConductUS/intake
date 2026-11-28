## ADDED Requirements

### Requirement: Every row has one outcome

Every row a source reads SHALL end in exactly one outcome: emitted as it is; emitted with a finding; left out with a finding, or counted as reported under the finding of a record it depends on; counted as not selected under a named reason; or a stopped command.

#### Scenario: A row with no problem

- **WHEN** a transform builds a valid record from a row and changes nothing
- **THEN** the record is emitted with no finding and the row counts as emitted

### Requirement: A row that cannot be built is reported on the licensing authority

A licensing authority is the `LicensingAuthorities` record of a state's officer licensing body. When a transform reads a row it cannot build into a valid record, it SHALL emit no record for it and SHALL report one finding on the licensing authority the row's data belongs to. The finding SHALL hold what was left out, the reason, the source namespace, the row's source record ID and evidence that says where the row can be seen.

#### Scenario: A department that fails the agency schema

- **WHEN** the TCOLE transform reads a department row that fails the agency schema
- **THEN** no agency is emitted for it
- **AND** the TCOLE licensing authority carries one finding naming the department number and the reason

#### Scenario: The row is fixed in a later file

- **WHEN** a later transform builds a record from a row that was left out before
- **THEN** the record is emitted and `data generate` marks the earlier annotation resolved, keeping its ID

### Requirement: Rows that hold one source record share one finding

When several rows a transform leaves out hold one source record, they SHALL share one finding, and each SHALL count as reported.

#### Scenario: One docket in the files of two agencies

- **WHEN** the CourtListener transform reads one docket that cannot be built in the files of two agencies of one state
- **THEN** the licensing authority of that state carries one finding for the docket, and both rows count as reported

### Requirement: The licensing authority is the one the data belongs to

A licensing source, whose data is a licensing body's own records (TCOLE, Minnesota POST, Oregon DPSST), SHALL report on that body's licensing authority. Any other source SHALL report on the licensing authority of the state of the agency the row is about, or, when its rows name no agency, of the state the row names. A source that cannot tell which state a left-out row belongs to SHALL fail, naming the row.

#### Scenario: A source that covers many states

- **WHEN** the Clearinghouse transform leaves out a case about a Texas agency because the case names an officer and has no title or filing date
- **THEN** the finding is on the Texas licensing authority

#### Scenario: No state can be named

- **WHEN** a transform leaves out a row and cannot name the state it belongs to
- **THEN** the transform exits non-zero naming the source and the row

### Requirement: A source emits, on every run, the licensing authorities it reports on

A licensing source SHALL emit its own licensing authority every time it runs. Any other source reports on state authorities and does not create them: it SHALL emit a `PATCH` of an existing authority that changes no field and carries the findings, for each state it read in that run, the state of an agency it read or a state a row names, with an empty list of findings when it has none. A state it did not read SHALL NOT be emitted, and its earlier annotations SHALL stay as they are.

#### Scenario: A state with no findings in this run

- **WHEN** the Clearinghouse transform processes Texas agencies and leaves out no Texas case
- **THEN** it emits the Texas licensing authority with an empty list of findings
- **AND** `data generate` marks resolved any earlier annotation of that source on the Texas licensing authority

### Requirement: A record built with a problem carries the finding

When a transform builds a valid record and had to correct, replace or leave off one of its values, it SHALL emit the record and SHALL report the finding on that record.

#### Scenario: One officer of two does not resolve

- **WHEN** an approved submission names two officers and one resolves
- **THEN** the review is emitted for the resolved officer and carries a finding about the other, naming the officer by position in the submission and holding none of the submitter's text

### Requirement: A run that did not cover an authority leaves its annotations

A run that did not fully cover what a licensing authority's findings are about (an agency whose search failed or was skipped, an acquire of only some name prefixes) SHALL emit that authority with no `defects` key, so its earlier annotations stay as they are.

#### Scenario: A failed search

- **WHEN** the CourtListener acquire's search for one Texas agency failed and the transform runs
- **THEN** the Texas licensing authority is emitted with no `defects` key, and no earlier annotation on it is resolved

### Requirement: A condition good data cannot have stops the command

A source phase SHALL fail, naming the source, the row or input and the problem, when it meets a condition its README lists as impossible in good data. A condition that the source's real data has shown SHALL NOT be listed as impossible; it SHALL get a finding or a count.

#### Scenario: A condition real data has shown

- **WHEN** the TCOLE workbook has a department with a blank name, as the workbook of 2025-02-10 does
- **THEN** the department is left out with a finding on the TCOLE licensing authority and the transform continues

### Requirement: Conditions listed as impossible for every source

These conditions SHALL be listed as impossible in good data for every source that can meet them, unless that source's real data has shown the condition: in an acquire, an agency with a blank name or an unmapped state; in any phase, a blank ID column, a numeric setting that is blank or not a whole number, an input path that cannot be read, and two rows that produce one record key with different content.

#### Scenario: An agency with a blank name in an acquire

- **WHEN** the CourtListener acquire is given an agency with a blank name
- **THEN** the acquire exits non-zero naming the agency's ID
- **AND** no request is made for any later agency

#### Scenario: A minimum year that is not a number

- **WHEN** `CLEARINGHOUSE_MIN_YEAR` is `abc`
- **THEN** the transform exits non-zero naming the setting and its value

#### Scenario: Two rows with one key

- **WHEN** two rows produce the same record key and differ in content
- **THEN** the transform exits non-zero naming the key

### Requirement: A row that is not selected is counted

A row that is read and is left out by the source's stated selection rule SHALL be counted under a named reason. A selection rule leaves out a row that names no officer or agency the database knows, a row outside the source's stated scope, a row that adds no fact an emitted record lacks (for example a second separation), and an agency the acquire skipped because `excluded.yaml` lists it. The transform SHALL log the count for each reason. No annotation SHALL be written for it.

#### Scenario: A case that names no known officer

- **WHEN** none of the defendants of a case the Clearinghouse transform reads resolves to an officer
- **THEN** no case is emitted, no annotation is written, and the count for that reason goes up by one

### Requirement: Every row is accounted for

A transform SHALL state, for each input it reads (a set of rows the source names), the number of rows read, emitted, reported and not selected by reason. The shared transform step SHALL fail when the rows read do not equal the sum of the others, and SHALL log the totals when the transform ends.

#### Scenario: A row dropped with no outcome

- **WHEN** a transform reads 100 rows and accounts for 99
- **THEN** the transform exits non-zero naming the input and the difference

#### Scenario: All rows accounted for

- **WHEN** a transform reads 100 rows, emits 90, reports 4 and does not select 6
- **THEN** the transform succeeds and logs those numbers, with the not-selected count given by reason

### Requirement: What an input is

An input is a list of rows the source names: a sheet, a kind of file, a series of pages, or a list within one file. A source SHALL take the number of rows read from the input's own size where the input states one. A source MAY treat a line that holds no value in any column it reads as no row; it then does not count it.

#### Scenario: Rows read come from the sheet

- **WHEN** the TCOLE transform reads a `Services` sheet of 100 rows
- **THEN** it states 100 rows read for the `Services` input

### Requirement: How a row is counted

A row SHALL be counted once, at the input it was read from, even when it feeds several records. A row emitted with a finding on its record SHALL count as emitted. A row any of whose records is left out with a finding SHALL count as reported, even when another record it feeds is emitted. A row left out because a record it depends on was left out SHALL count as reported, under that record's finding, and SHALL get no annotation of its own.

#### Scenario: A row that feeds several records

- **WHEN** the TCOLE transform reads one `Services` row that feeds a license, an authority license and an assignment
- **THEN** that row is counted once, as read and emitted, at the `Services` sheet

#### Scenario: A row whose agency was left out

- **WHEN** the Oregon DPSST transform leaves out an agency and reads three employment rows at that agency
- **THEN** the three rows count as reported under the agency's finding, and no other annotation is written for them

#### Scenario: A row with one record left out

- **WHEN** the TCOLE transform reads a `Services` row with no start date
- **THEN** its license is emitted, its assignment is left out with a finding, and the row counts as reported

### Requirement: The shared step checks the accounting

The shared transform step SHALL fail when a source states no accounting, an input with a blank name, or a count that is not a whole number of zero or more. The counts the source states SHALL be taken before the shared step applies `excluded.yaml` to the records, so a record excluded there counts as emitted.

#### Scenario: A count that is not a whole number

- **WHEN** a source states `-1` rows emitted for an input
- **THEN** the transform exits non-zero naming the source, the input and the value

### Requirement: An acquire keeps each agency's results apart

An acquire that saves results for each agency SHALL name the agency's output file, and any cache entry it keeps for each agency, by the agency's source ID, so that two agencies with the same name never share a file or an entry of a cache the source keeps.

#### Scenario: Two agencies with one name

- **WHEN** an acquire searches for two agencies named "Springfield Police Department" in different states
- **THEN** each has its own output file, and the YouTube acquire gives each its own cache entry
