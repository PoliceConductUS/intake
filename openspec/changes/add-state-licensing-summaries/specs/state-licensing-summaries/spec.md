# state-licensing-summaries

## Purpose

Give each state's officer-licensing facts a durable data home, a committed
raw-data location per state licensing organization, and a deterministic
import/re-import path.

## ADDED Requirements

### Requirement: Committed per-state licensing raw data

`data/licensing/<state_or_territory_slug>/licensing.json` SHALL be the only
source of licensing-summary content. Each file SHALL carry explicit
checked-in IDs for the location report and every source row, a `status` of
`pending` or `verified`, and source links for every fact via `sourceKeys`.

#### Scenario: Verified file carries complete provenance

- WHEN a file has `status: "verified"`
- THEN it contains an organization (name, abbreviation, url), at least one
  fact, at least one source, and every `fact.sourceKeys` entry matches a
  source `key` in the same file, otherwise validation fails loudly.

#### Scenario: Pending stub is visible but inert

- WHEN a file has `status: "pending"`
- THEN the importer reports it as skipped by name and writes nothing for it.

### Requirement: Licensing summary rows in location_reports

Imported licensing summaries SHALL be written as
`public.location_reports` rows with `report_type = 'licensing_summary'`,
`report_key = 'licensing-summary'`, the payload contract
`{organization, facts, note}`, and their sources as
`public.location_report_sources` rows, all using the file's explicit IDs.

#### Scenario: Location resolution fails loudly

- WHEN a file's state slug has no `location_path` row with `level = 'state'`
- THEN the import of that state fails with a named error and a non-zero exit
  code, and no partial rows are written.

### Requirement: Deterministic re-import

`intake import licensing [state-slugs...]` SHALL replace each verified
state's licensing summary atomically: within a transaction, delete the
existing `(location_path_id, 'licensing-summary')` report and its sources,
then insert the file content. Running the command twice with the same input
SHALL produce identical database state.

#### Scenario: Re-import after edit

- WHEN the Texas file is imported, edited, and imported again
- THEN the database holds exactly one Texas licensing-summary report whose
  payload and sources match the latest file.

#### Scenario: Dry run writes nothing

- WHEN the command runs with `--dry-run`
- THEN it prints the per-state plan (imports, skips, failures) and performs
  no database writes.
