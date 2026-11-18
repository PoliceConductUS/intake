## ADDED Requirements

### Requirement: All state is under one root

Every state file SHALL be under `$INTAKE_WORKSPACE/state/`. No command SHALL read from or write to `$INTAKE_WORKSPACE/intake/state/`.

#### Scenario: The old root is present

- **WHEN** a command that reads state runs in a workspace that has `intake/state/`
- **THEN** the command exits non-zero naming that folder
- **AND** it reads and writes no state

### Requirement: A namespace owns its own state folder

`state/<namespace>/` SHALL hold the state that namespace owns, where a namespace is a source ID or `intake`. A source's initial agency roots SHALL be at `state/<namespace>/InitialAgencyRoots/`.

#### Scenario: A source's phase state

- **WHEN** the transform of `gov/texas/tcole` writes state
- **THEN** it writes under `state/gov/texas/tcole/`

#### Scenario: Initial agency roots

- **WHEN** intake loads the initial agency roots of `gov/texas/tcole`
- **THEN** it reads `state/gov/texas/tcole/InitialAgencyRoots/`

### Requirement: Intake keeps its state about another namespace under its own folder

State the root intake module keeps about a namespace across commands SHALL be at `state/intake/namespaces/<namespace>/<Kind>/`, with the exact kind as the folder name. This SHALL include the source-name mapping, `PropertyCorrection`, `CallResult`, `BinaryFile` and `RecordsRequest`.

#### Scenario: A records request

- **WHEN** intake saves a records request for `gov/sc/sccja`
- **THEN** the file is under `state/intake/namespaces/gov/sc/sccja/RecordsRequest/`

### Requirement: Intake's own state is not under namespaces

State the root intake module owns itself SHALL be under `state/intake/` and not under `state/intake/namespaces/`. `ResolvedProperty` SHALL be at `state/intake/ResolvedProperty/`.

#### Scenario: A resolved property

- **WHEN** intake caches a resolved property
- **THEN** the file is under `state/intake/ResolvedProperty/`

### Requirement: A namespace has any number of ordered acquires

Every namespace SHALL support any number of acquires. Each acquire SHALL be a command whose output is in its command folder. A phase that reads acquired input SHALL find it by reading the command folders, SHALL keep the acquire commands of the namespace that completed, and SHALL process them in the order in which the data was acquired: the time each acquire ran, which its command folder's name starts with. That order SHALL NOT depend on the order in which the commands that read the input run.

#### Scenario: Two acquires of one source

- **WHEN** `gov/irvingtx/arrests` has two completed acquire commands
- **THEN** the transform reads both, the earlier acquire first

#### Scenario: An acquire that did not complete

- **WHEN** a command folder holds an acquire of the namespace that did not complete
- **THEN** the transform does not read it

#### Scenario: The same input on a later run

- **WHEN** the transform runs twice with no new acquire between
- **THEN** it reads the same command folders in the same order both times

### Requirement: The outputs of a namespace's acquires combine in order

The outputs of a namespace's acquires SHALL combine through the database: each acquire SHALL be transformed, generated and applied alone, earliest first, so that a record a later acquire also holds is compared and updated, and a record only an earlier acquire holds is kept as that acquire wrote it.

#### Scenario: A later acquire holds a changed record

- **WHEN** two completed acquires of a namespace hold the same record with different values
- **THEN** the record is written from the earlier acquire and then updated from the later one

#### Scenario: A record only an earlier acquire holds

- **WHEN** a record is in the earlier of two completed acquires and not in the later one
- **THEN** the record stays as the earlier acquire wrote it

### Requirement: A command run alone replays the acquires not yet processed

`data transform` and `data generate`, run alone for a namespace, SHALL first replay every completed acquire of that namespace not yet processed, in order, oldest first, each through `data transform`, `data generate` and `data up` as `data reset` does, and SHALL then process the latest. An acquire SHALL NOT be considered only when a mutation applied to the targeted database included that exact acquire; every other listed acquire SHALL be considered, oldest first.

#### Scenario: Two acquires completed between transforms

- **WHEN** two acquires of a namespace complete and then `data transform` runs for it
- **THEN** the earlier acquire is transformed, generated and applied first, and then the later one is processed

#### Scenario: Nothing to replay

- **WHEN** a mutation applied to the targeted database included every completed acquire but the latest
- **THEN** `data transform` processes only the latest

#### Scenario: A database with no recorded acquires

- **WHEN** no mutation applied to the targeted database names an included acquire
- **THEN** every completed acquire of the namespace is considered, oldest first

### Requirement: acquire.yaml lists a namespace's acquires

`state/<namespace>/acquire.yaml` SHALL hold the ordered list of every successful acquire run of the namespace, and `resume` while an acquire is unfinished. It SHALL hold no `latest`: the last successful acquire is the list's last entry. It SHALL hold nothing about which acquires were processed. Later phases SHALL choose their inputs from the list: every listed acquire not already in the targeted database, oldest first.

#### Scenario: An acquire completes

- **WHEN** an acquire of a namespace completes
- **THEN** it is added at the end of the list in that namespace's `acquire.yaml`

### Requirement: A mutation records the acquires it included

Each `DatabaseMutations` envelope that `data generate` writes SHALL record the mutation that was the chain head when the generate started and every acquire it included, an acquire that contributed no change among them, by namespace, command ID, output path relative to the intake workspace, and the digest of that output folder.

#### Scenario: A generate includes an acquire

- **WHEN** `data generate` writes a mutation from a namespace's acquire
- **THEN** the mutation names that acquire by namespace, command ID, relative output path and digest

### Requirement: An acquire is in the database once an applied mutation lists it

An acquire SHALL count as in the database once any mutation applied to it lists it, whether or not it contributed a change. A generate that writes no mutation SHALL record no acquire, so its acquires are considered again next time.

#### Scenario: An acquire with no changes in an applied mutation

- **WHEN** a generate includes two acquires, one of which changes nothing, and the mutation it writes is applied
- **THEN** both acquires are listed in that mutation and neither is considered again

#### Scenario: A generate that writes no mutation

- **WHEN** a generate includes an acquire and finds no change, so it writes no mutation
- **THEN** no mutation lists that acquire, and the next phase considers it again

### Requirement: A manual acquire uses the folder structure of an automated one

Files that enter the workspace by hand or by a download outside a source's acquire phase SHALL be saved in a command folder by an acquire command, as an automated acquire does. No source phase SHALL read input from a folder outside a command folder and `state/`. A downloaded file SHALL be cached so that it is not downloaded again.

#### Scenario: Files placed by hand

- **WHEN** an operator has a set of Irving arrest files in a local folder
- **THEN** `intake data acquire gov/irvingtx/arrests --from-local <folder>` saves them in a command folder as one acquire

#### Scenario: A reply to a records request

- **WHEN** a sync downloads a reply message and its attachments
- **THEN** they are saved in that sync's command folder
- **AND** a later sync does not download them again

### Requirement: The namespaces folder appears once

No folder named `namespaces` SHALL sit directly under `state/`, and none SHALL sit below another folder named `namespaces`.

#### Scenario: A source ID with a segment named namespaces

- **WHEN** a path under `state/` would hold two folders named `namespaces`
- **THEN** the command that would write it exits non-zero naming the path
