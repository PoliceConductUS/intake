## REMOVED Requirements

### Requirement: Irving workbook acquisition input

**Reason**: The Irving acquire no longer reads a fixed folder at the top of the workspace; each set of hand-placed files is its own acquire command.

**Migration**: Run `intake data acquire gov/irvingtx/arrests` and put `arrests.xlsx` and `geography/` in the folder it prints, or run it with `--from-local <folder>` on a folder holding them. The one-time move puts the old folder at `state/gov/irvingtx/arrests/source/`.

## ADDED Requirements

### Requirement: Irving reads its files from its own acquire output folder

The Irving arrests source MUST be manual-only (`manual: true`) and MUST read `arrests.xlsx` and `geography/` from its own acquire output folder, whether a person put them there or `--from-local` copied them. It MUST NOT read a folder outside its command folder or search alternative paths, and MUST NOT copy those files into `evidence/`. Its normalized JSONL MUST be written to that output folder.

#### Scenario: Workbook is in the acquire's output folder

- **WHEN** `intake data acquire gov/irvingtx/arrests --from-local <folder>` runs on a folder holding `arrests.xlsx` and `geography/`
- **THEN** the acquire reads that workbook from its output folder and writes normalized JSONL to that folder

#### Scenario: Workbook is missing from the acquire's output folder

- **WHEN** acquisition runs and its output folder holds no `arrests.xlsx`
- **THEN** acquisition fails with an error naming the missing file
