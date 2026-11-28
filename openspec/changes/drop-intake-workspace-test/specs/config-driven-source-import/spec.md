## ADDED Requirements

### Requirement: The workspace root is read only from INTAKE_WORKSPACE

Every intake command and script that uses the workspace SHALL take the workspace root only from `INTAKE_WORKSPACE`. When `INTAKE_WORKSPACE_TEST` is defined, with any value including blank, every such command and script SHALL fail before it reads or writes anything, with an error that says to unset it.

#### Scenario: Both workspace variables are set

- **WHEN** `INTAKE_WORKSPACE` names an existing folder and `INTAKE_WORKSPACE_TEST` names another folder
- **THEN** a command or script that uses the workspace fails with `INTAKE_WORKSPACE_TEST is no longer read; unset it and set INTAKE_WORKSPACE.`
- **AND** nothing is read from or written under either folder

#### Scenario: INTAKE_WORKSPACE_TEST is blank

- **WHEN** `INTAKE_WORKSPACE` names an existing folder and `INTAKE_WORKSPACE_TEST` is defined and blank
- **THEN** a command or script that uses the workspace fails with `INTAKE_WORKSPACE_TEST is no longer read; unset it and set INTAKE_WORKSPACE.`
- **AND** nothing is read from or written under the folder `INTAKE_WORKSPACE` names

#### Scenario: Only INTAKE_WORKSPACE_TEST is set

- **WHEN** `INTAKE_WORKSPACE` is unset or blank and `INTAKE_WORKSPACE_TEST` names a folder
- **THEN** a command or script that uses the workspace fails with `INTAKE_WORKSPACE_TEST is no longer read; unset it and set INTAKE_WORKSPACE.`
- **AND** nothing is written under the folder `INTAKE_WORKSPACE_TEST` names

### Requirement: The test runner blanks INTAKE_WORKSPACE

The test runner SHALL blank `INTAKE_WORKSPACE`, so a test that sets no workspace fails instead of using the workspace of the shell that runs the tests.

#### Scenario: A test sets no workspace

- **WHEN** a test runs a command or script that uses the workspace without setting `INTAKE_WORKSPACE`
- **AND** the shell that runs the tests sets `INTAKE_WORKSPACE` to an existing folder
- **THEN** the command or script fails with an error that names `INTAKE_WORKSPACE`
- **AND** nothing is read from or written under the folder the shell names
