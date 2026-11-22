## ADDED Requirements

### Requirement: Every annotation names a message code

Every `data_annotation` row SHALL hold `message_code`, a foreign key to the manual-records table `data_annotation_message`, which holds `code` and a plain-English `message`. The site SHALL get the public text by joining this table. The code SHALL be the finding code the producer reports (ADR 0040).

#### Scenario: Site shows the message

- **WHEN** an annotation has `message_code` `standardized_text`
- **THEN** the site shows the `message` stored for `standardized_text`

#### Scenario: Unknown code

- **WHEN** a producer reports a finding whose code has no `data_annotation_message` row
- **THEN** generation fails and names the code

### Requirement: Public messages hold no internal identifiers

A `data_annotation_message.message` SHALL NOT contain a canonical ID, a slug, a source namespace or a field name. It SHALL tell a reader what is wrong and with which value.

#### Scenario: Excluded duplicate

- **WHEN** a record is excluded as a duplicate of an existing record
- **THEN** its annotation's message code is `excluded_duplicate` and the message names no ID or slug

### Requirement: Codes for the corrections queue

The manual records SHALL include at least these codes: `standardized_text` (a stored value was standardized), `excluded_duplicate` (a record was excluded as a duplicate), `excluded_record` (a record was excluded for another stated reason), and `administrative_correction` (a reference was corrected by an explicit correction).

#### Scenario: Excluded record that is not a duplicate

- **WHEN** a record is excluded with a reason that is not a duplicate
- **THEN** its annotation's message code is `excluded_record`, and the site needs no text test on the message
