## ADDED Requirements

### Requirement: A row that cannot be built is reported on the licensing authority

When a transform reads a row it cannot build into a valid record, it SHALL emit no record for it and SHALL report one finding on the licensing authority the row's data belongs to. The finding SHALL hold what was left out, the reason, the source namespace, the row's source record ID and evidence that says where the row can be seen.

#### Scenario: A department that fails the agency schema

- **WHEN** the TCOLE transform reads a department row that fails the agency schema
- **THEN** no agency is emitted for it
- **AND** the TCOLE licensing authority carries one finding naming the department number and the reason

#### Scenario: The row is fixed in a later file

- **WHEN** a later transform builds a record from a row that was left out before
- **THEN** the record is emitted and `data generate` marks the earlier annotation resolved, keeping its ID

### Requirement: The licensing authority is the one the data belongs to

A licensing source SHALL report on its own licensing authority. Any other source SHALL report on the licensing authority of the state of the agency the row is about. A source that cannot tell which state a left-out row belongs to SHALL fail, naming the row. A source SHALL emit each licensing authority it may report on every time it runs.

#### Scenario: A source that covers many states

- **WHEN** the Clearinghouse transform leaves out a case about a Texas agency
- **THEN** the finding is on the Texas licensing authority

#### Scenario: No state can be named

- **WHEN** a transform leaves out a row and cannot name the state it belongs to
- **THEN** the transform exits non-zero naming the source and the row

### Requirement: A record built with a problem carries the finding

When a transform builds a valid record and had to correct, replace or leave off one of its values, it SHALL emit the record and SHALL report the finding on that record.

#### Scenario: One officer of two does not resolve

- **WHEN** an approved submission names two officers and one resolves
- **THEN** the review is emitted for the resolved officer and carries a finding naming the other

### Requirement: A condition good data cannot have stops the command

A source phase SHALL fail, naming the source, the row or input and the problem, when it meets a condition its spec lists as impossible in good data. These SHALL include an agency with a blank name or an unmapped state, a blank ID column, a numeric setting that is not a number, an input path that cannot be read, and two rows that produce one record key with different content.

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

A row that is read and is left out by the source's stated selection rule SHALL be counted under a named reason. The transform SHALL log the count for each reason. No annotation SHALL be written for it.

#### Scenario: A case that names no known officer

- **WHEN** none of a case's defendants resolves to an officer
- **THEN** no case is emitted, no annotation is written, and the count for that reason goes up by one

### Requirement: Every row is accounted for

A transform SHALL state, for each input it reads, the number of rows read, emitted, reported and not selected by reason. The shared transform step SHALL fail when the rows read do not equal the sum of the others, and SHALL log the totals as the transform's last line.

#### Scenario: A row dropped with no outcome

- **WHEN** a transform reads 100 rows and accounts for 99
- **THEN** the transform exits non-zero naming the input and the difference

#### Scenario: All rows accounted for

- **WHEN** a transform reads 100 rows, emits 90, reports 4 and does not select 6
- **THEN** the transform succeeds and its last log line gives those four numbers

### Requirement: An acquire keeps each agency's results apart

An acquire that saves results for each agency SHALL name the agency's cache entry and output file by the agency's source ID, so that two agencies with the same name never share an entry or a file.

#### Scenario: Two agencies with one name

- **WHEN** an acquire searches for two agencies named "Springfield Police Department" in different states
- **THEN** each has its own cache entry and its own output file
