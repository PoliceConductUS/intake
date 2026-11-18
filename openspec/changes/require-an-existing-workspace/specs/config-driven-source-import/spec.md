## ADDED Requirements

### Requirement: Every command requires an existing workspace named by an absolute path

Every intake command and script that uses the workspace SHALL take it from `INTAKE_WORKSPACE` (or `INTAKE_WORKSPACE_TEST` when that is set) and SHALL fail before it reads or writes anything in the workspace when the value is unset, blank, not an absolute path, or not an existing folder. The error SHALL name the variable and its value. No command or script SHALL create the workspace folder; a new workspace is started by creating its folder.

#### Scenario: Variable is unset or blank

- **WHEN** `INTAKE_WORKSPACE` is not set, or is blank
- **THEN** the command fails before it creates a command folder or reads any workspace state
- **AND** the error names the variable

#### Scenario: Relative path

- **WHEN** `INTAKE_WORKSPACE` is a relative path, even one that names an existing folder from the folder the command runs in
- **THEN** the command fails before it creates a command folder or reads any workspace state
- **AND** the error names the variable and the value

#### Scenario: Path is not an existing folder

- **WHEN** `INTAKE_WORKSPACE` is an absolute path that does not exist, or names a file
- **THEN** the command fails before it creates a command folder or reads any workspace state
- **AND** the folder is not created
- **AND** the error names the variable and the value

#### Scenario: A command that creates a command folder

- **WHEN** `data acquire`, `data transform <source>`, `data generate`, `data reset`, `data exclude`, a `cache` command or `photo import` runs with a workspace that is not an existing folder
- **THEN** it fails without creating the workspace or a command folder

#### Scenario: Records requests

- **WHEN** `intake requests submit`, `intake requests status` or `intake requests sync` runs with a workspace that is not an existing folder
- **THEN** it fails without creating the workspace or reading request history

#### Scenario: The data-mutation chain

- **WHEN** `data up`, `data status`, `data verify` or `data restore-identity` runs with a workspace that is not an existing folder
- **THEN** it fails instead of reading the chain as empty
- **AND** it does not report that the database is up to date, that there are no entries, or drift

#### Scenario: Transforming every source

- **WHEN** `data transform` runs with no source and a workspace that is not an existing folder
- **THEN** the command fails with the workspace error and a non-zero exit, instead of listing each source as skipped

#### Scenario: Publishing import schemas

- **WHEN** `npm run publish:import-schemas` runs with a workspace that is not an existing folder
- **THEN** it fails without creating the workspace or writing schema files

#### Scenario: Seeding a SourceNameToCanonicalId ledger

- **WHEN** `scripts/seed-tcole-ledger.ts` runs with a workspace that is not an existing folder
- **THEN** it fails without creating the workspace or writing SourceNameToCanonicalId records
