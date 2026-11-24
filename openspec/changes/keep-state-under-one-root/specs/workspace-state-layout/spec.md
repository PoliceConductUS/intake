## ADDED Requirements

### Requirement: The workspace has three top-level folders

Intake SHALL write in the workspace only under `command/`, `state/` and `data/`, and SHALL NOT write `assets/` or `media/`. No command SHALL check what else is at the top of the workspace.

#### Scenario: A command writes to the workspace

- **WHEN** any intake command writes a file in the workspace
- **THEN** the file is under `command/`, `state/` or `data/`

### Requirement: All state is under one root

Every state file SHALL be under `$INTAKE_WORKSPACE/state/`. No command SHALL read from or write to `$INTAKE_WORKSPACE/intake/state/`, except that the readers of initial agency roots and records requests SHALL fail, naming their old folder under `intake/state/namespaces/<namespace>/`, when it exists.

#### Scenario: A command writes state

- **WHEN** any command writes a state file
- **THEN** the file is under `$INTAKE_WORKSPACE/state/`

#### Scenario: Code names the old root

- **WHEN** a `.ts` file under `src/`, `sources/` or `scripts/` names `intake/state`, or passes `"intake"` directly followed by `"state"` to a path call
- **THEN** the architecture test fails naming that file, unless the file is one of those two readers checking its old folder

#### Scenario: A workspace that was not moved

- **WHEN** intake loads the initial agency roots of `gov/texas/tcole` and `intake/state/namespaces/gov/texas/tcole/InitialAgencyRoots/` exists
- **THEN** the command exits non-zero naming that folder

### Requirement: A namespace owns its own state folder

`state/<namespace>/` SHALL be the cross-command state folder that a command passed to a source gets, where a namespace is a source ID or `intake`.

#### Scenario: A source's phase state

- **WHEN** the transform of `gov/texas/tcole` writes state
- **THEN** it writes under `state/gov/texas/tcole/`

### Requirement: Intake keeps its state about a namespace under its own folder

State the root intake module keeps about a namespace across commands SHALL be at `state/intake/namespaces/<namespace>/<Kind>/`, one folder per exact kind: the mapped entity's kind for the source-name mapping (such as `Agency` or `Personnel`), the record's own kind for `PropertyCorrection`, `RecordsRequest` and `InitialAgencyRoots`, and `BinaryFile` for the bytes of the namespace's files.

#### Scenario: A records request

- **WHEN** intake saves a records request for `gov/sc/sccja`
- **THEN** the file is under `state/intake/namespaces/gov/sc/sccja/RecordsRequest/`

#### Scenario: Initial agency roots

- **WHEN** intake loads the initial agency roots of `gov/texas/tcole`
- **THEN** it reads `state/intake/namespaces/gov/texas/tcole/InitialAgencyRoots/`

### Requirement: A namespaces folder separates a parent's state by namespace

A `namespaces/` folder under a state folder SHALL hold that parent namespace's state that is separated by another namespace. Intake's source-name mappings SHALL be at `state/intake/namespaces/<namespace>/` for every namespace, `intake` included. Intake's state that is not separated by namespace SHALL be directly under `state/intake/`; `ResolvedProperty` SHALL be at `state/intake/ResolvedProperty/`.

#### Scenario: A mapping of intake's own records

- **WHEN** intake maps a source name of a record the namespace `intake` produces
- **THEN** the mapping file is under `state/intake/namespaces/intake/<Kind>/`

#### Scenario: A resolved property

- **WHEN** intake caches a resolved property
- **THEN** the file is under `state/intake/ResolvedProperty/`

#### Scenario: The old resolved property folder is present

- **WHEN** intake reads resolved properties and `state/intake/namespaces/intake/ResolvedProperty/` exists
- **THEN** the command exits non-zero naming that folder
- **AND** it resolves no property

### Requirement: A namespace has any number of ordered acquires

Every source SHALL support any number of acquires, by its acquire module or by `--from-local`, each a command whose output is in its command folder. A phase SHALL find acquired input through the namespace's `acquire.yaml` list, and SHALL process the listed acquires in the order each acquire ran, which its command folder's name starts with, whatever order the commands that read them run in.

#### Scenario: Two acquires of one source

- **WHEN** `gov/irvingtx/arrests` has two completed acquires and neither is in the targeted database
- **THEN** the earlier acquire is processed first, and then the later one

#### Scenario: An acquire that did not complete

- **WHEN** a command folder holds an acquire of the namespace that did not complete
- **THEN** no `data transform`, `data generate` or `data update` reads it

#### Scenario: The same list on a later run

- **WHEN** a phase runs twice and the list does not change between the runs
- **THEN** both runs take the listed acquires in the same order

#### Scenario: A listed acquire whose output was removed

- **WHEN** a listed acquire's output folder was removed and its command folder kept, and it is not the last entry
- **THEN** phases skip it and log its path
- **AND** it is never pending

### Requirement: The outputs of a namespace's acquires combine in order

A transform given several acquires of a namespace SHALL combine them oldest first: a record a later acquire also holds SHALL take the later acquire's values, and a record only an earlier acquire holds SHALL be kept as that acquire has it.

#### Scenario: A later acquire holds a changed record

- **WHEN** two acquires taken as input hold the same record with different values
- **THEN** the transform's `Artifacts` hold the later acquire's values for it

#### Scenario: A record only an earlier acquire holds

- **WHEN** a record is in the earlier of two acquires taken as input and not in the later one
- **THEN** the transform's `Artifacts` hold it as the earlier acquire has it

### Requirement: Only data update writes to the database

`data transform` and `data generate` SHALL NOT write to the database. `data update` SHALL be the only one of the `data` commands that transform, generate or apply to write to it, and `data reset` SHALL write to it only through the `data update` it runs.

#### Scenario: A transform run alone

- **WHEN** `data transform` runs for a namespace with two pending acquires
- **THEN** no row of the targeted database changes

### Requirement: A command is told which acquires to take as input

`data transform` and `data generate` SHALL take as input a list of acquires, oldest first, that their caller gives, or the pending acquires when the caller gives none. No command SHALL be steered by rewriting `acquire.yaml`.

#### Scenario: Reset prepares a source

- **WHEN** `data reset` prepares a source with three listed acquires
- **THEN** the transform it runs takes all three as input, oldest first
- **AND** `acquire.yaml` is not written

### Requirement: A command run alone takes every pending acquire as input

Run without a given list for a source that is not standalone, `data transform` SHALL transform the pending acquires, oldest first, or the list's last entry when none is pending; `data generate` SHALL generate from a recorded transform of exactly those acquires; and `data update` SHALL do both and apply the result. The pending acquires SHALL be the listed acquires after the newest listed acquire the targeted database holds; with none held, every listed acquire SHALL be pending.

#### Scenario: Two acquires completed between transforms

- **WHEN** two acquires of a namespace complete and then `data transform` runs for it
- **THEN** the transform takes both as input, the earlier first

#### Scenario: Every acquire is in the database

- **WHEN** the targeted database holds the list's last entry
- **THEN** `data transform` transforms the list's last entry alone

#### Scenario: A database with no recorded acquires

- **WHEN** the targeted database holds no listed acquire
- **THEN** every listed acquire of the namespace is pending, oldest first

#### Scenario: Generate after a transform of other acquires

- **WHEN** `data generate` runs and the recorded transform read acquires other than the pending ones
- **THEN** the command exits non-zero naming `data transform <source>`

### Requirement: Acquires are processed in the order they ran

A listed acquire that the targeted database does not hold, while a later listed acquire of the same namespace is in it, SHALL fail any command that reads the pending acquires, naming both.

#### Scenario: An acquire left out of the database

- **WHEN** the database holds the second of three listed acquires but not the first
- **THEN** the command exits non-zero naming the first and the second

### Requirement: A command that reads the database needs it configured

`data transform` and `data generate` of a source that is not standalone read the targeted database's ledger to find the pending acquires. Without `DATABASE_URL` they SHALL fail before starting their work, naming it, writing no state and leaving no command folder. A standalone source SHALL take no acquire as input.

#### Scenario: No database is configured

- **WHEN** `data transform` or `data generate` runs for a source that is not standalone and `DATABASE_URL` is not set
- **THEN** the command exits non-zero naming `DATABASE_URL`
- **AND** it writes no state and leaves no command folder

### Requirement: acquire.yaml lists a namespace's acquires

`state/<namespace>/acquire.yaml` SHALL hold `acquires`, the list of every complete acquire of the namespace, each named by its output folder relative to the workspace, in command-folder-name order. An acquire SHALL be complete only when its entry is in the list. The file SHALL hold no key but `acquires`, `resume` and, for a manual-only source, `active`; the last complete acquire is the list's last entry. `resume` and `active` SHALL NOT be entries of the list.

#### Scenario: An acquire completes

- **WHEN** an acquire of a namespace completes
- **THEN** its output folder is added to the list in that namespace's `acquire.yaml`, in the place its command folder's name gives

#### Scenario: An acquire that does not complete

- **WHEN** an acquire of a namespace starts and does not complete
- **THEN** `resume` in that namespace's `acquire.yaml` names its output folder
- **AND** the list does not change

#### Scenario: An old acquire.yaml

- **WHEN** a command reads an `acquire.yaml` that holds `latest` or any key other than `acquires`, `resume` and `active`
- **THEN** the command exits non-zero naming that file

### Requirement: A mutation records the acquires it came from

Each top-level `DatabaseMutations` envelope intake generates SHALL list in `acquires` every acquire its transform read, oldest first, each identified by the command ID of the command that produced it, with its namespace, relative output path and folder digest as evidence. A standalone source's envelope SHALL hold an empty list; a chunk envelope SHALL hold none. A top-level envelope without `acquires` SHALL fail to read.

#### Scenario: A generate includes two acquires

- **WHEN** `data generate` writes a mutation from a transform of two acquires
- **THEN** the mutation lists both by command ID, oldest first, with their namespace, relative output path and digest

#### Scenario: A standalone source

- **WHEN** `data generate` writes a mutation for `org/policeconduct/manual`
- **THEN** the mutation's `acquires` is an empty list

#### Scenario: An entry written before this change

- **WHEN** a command reads a top-level chain entry with no `acquires`
- **THEN** the command exits non-zero naming the file

### Requirement: An acquire is in the database once an applied mutation lists it

An acquire SHALL count as in a database once a mutation applied to that database lists its command ID, whether or not it changed anything. Each applied mutation SHALL be read from its file in `data/mutations/`, which SHALL match the checksum the database's ledger holds for it. A generate that writes no mutation SHALL record no acquire, so its acquires stay pending.

#### Scenario: An applied mutation lists an acquire

- **WHEN** a mutation that lists an acquire is applied
- **THEN** no later command run against that database takes that acquire as input when given no list

#### Scenario: A generate that writes no mutation

- **WHEN** a generate finds no change for its acquires, so it writes no mutation
- **THEN** no mutation lists them, and they stay pending

#### Scenario: An applied mutation's file has changed

- **WHEN** an applied mutation's file is missing or does not match the ledger's checksum
- **THEN** the command exits non-zero naming that mutation's version

### Requirement: A manual acquire uses the folder structure of an automated one

Files placed by hand SHALL enter the workspace in an acquire folder made by an acquire command, as an automated acquire's files do. No source phase SHALL read input from a folder outside a command folder and `state/`.

#### Scenario: Files placed by hand

- **WHEN** an operator has a set of Irving arrest files in a local folder
- **THEN** `intake data acquire gov/irvingtx/arrests --from-local <folder>` saves them in an acquire folder as one acquire

### Requirement: A manual-only source gets an acquire folder to fill

A source that sets `manual: true` SHALL be manual-only, with at most one active acquire, named by `active` in `acquire.yaml` and not listed. `data acquire` of it SHALL keep an active acquire whose folder is empty, complete one whose folder holds files (run the source's acquire, list it, make a new active acquire), make one when there is none, and print the active folder's path for the person to put files in.

#### Scenario: No active acquire

- **WHEN** `data acquire gov/irvingtx/arrests` runs and the source has no active acquire
- **THEN** a new acquire folder is created and named by `active`
- **AND** the command prints its path and tells the person to put the files there

#### Scenario: The active folder is still empty

- **WHEN** `data acquire gov/irvingtx/arrests` runs and the active acquire's folder is empty
- **THEN** no new folder is created
- **AND** the command prints that folder's path

#### Scenario: The active folder holds files

- **WHEN** `data acquire gov/irvingtx/arrests` runs and the active acquire's folder holds the workbook
- **THEN** the source's acquire runs on that folder and the folder is added to the list
- **AND** a new empty active acquire is created and its path printed

#### Scenario: Files from a local folder

- **WHEN** `data acquire gov/irvingtx/arrests --from-local <folder>` runs while the active acquire's folder is empty
- **THEN** the files are copied into that folder, the source's acquire runs on it, and it is added to the list

#### Scenario: Transform and reset meet an active acquire

- **WHEN** `data transform` or `data reset` runs for a manual-only source with an active acquire
- **THEN** it logs the active folder's path as waiting for files and takes nothing from it
- **AND** the active acquire stays as it is

### Requirement: A records request's files go to its acquire folder

A records request whose answer is files SHALL have an acquire folder of its source, made as for a manual-only source, and SHALL be unfulfilled while that folder is empty. A sync that receives an answer's attachments SHALL save them in that folder.

#### Scenario: An agency answers with attachments

- **WHEN** a sync receives an email answer with attachments to an unfulfilled records request
- **THEN** the attachments are saved in that request's acquire folder

### Requirement: The namespaces folder appears once

No folder named `namespaces` SHALL sit directly under `state/`, and none SHALL sit below another folder named `namespaces`. A source ID or namespace with a segment named `namespaces`, or of more than one segment whose first segment is `intake`, SHALL be rejected. The namespace `intake` SHALL stay valid.

#### Scenario: A source ID with a segment named namespaces

- **WHEN** a command is given the source ID `namespaces/example` or `gov/namespaces/example`
- **THEN** the command exits non-zero naming the source ID
- **AND** it writes no state

#### Scenario: A source ID that starts with intake

- **WHEN** a command is given the source ID `intake/example`
- **THEN** the command exits non-zero naming the source ID

#### Scenario: The namespace intake

- **WHEN** `data reset` creates its command folder under the namespace `intake`
- **THEN** the namespace is accepted
