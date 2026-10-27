## ADDED Requirements

### Requirement: Irving workbook acquisition input

The Irving arrests source MUST read its FOIA workbook from `$INTAKE_WORKSPACE/gov.irvingtx.arrests/source/arrests.xlsx`. It MUST NOT require an Irving-specific environment variable or search alternative paths. The acquired normalized JSONL MUST continue to be written through the existing command acquisition output flow.

#### Scenario: Workbook exists at the canonical workspace path

- **WHEN** acquisition runs with a configured workspace containing `gov.irvingtx.arrests/source/arrests.xlsx`
- **THEN** it reads that workbook and writes normalized JSONL to the command output directory

#### Scenario: Workbook is missing from the canonical workspace path

- **WHEN** acquisition runs and the canonical workbook path does not exist
- **THEN** acquisition fails with an error naming the required workspace path
