## MODIFIED Requirements

### Requirement: Preserve spreadsheet and article evidence

Intake SHALL identify the Police Sexual Violence Project arrest tracker as
`org/psvproject/arrest-tracker`. It SHALL acquire the publisher's distinct
2025 and 2026 workbooks and preserve each workbook's original bytes, Google
Sheets URL, digest, row references, and embedded hyperlink targets. It SHALL
retain article response bodies, retrieval results, and digests.

#### Scenario: An article appears in both annual workbooks

- **WHEN** the two workbooks link to the same article URL
- **THEN** a single acquisition fetches the article once and mapping records identify both source documents and their corresponding rows

#### Scenario: A linked article cannot be retrieved

- **WHEN** an article request fails or is rejected
- **THEN** its URL and failure remain inspectable and it is not reported as mapped
