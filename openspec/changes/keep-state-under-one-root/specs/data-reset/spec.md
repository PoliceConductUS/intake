## MODIFIED Requirements

### Requirement: Replay retained acquisition history

Reset SHALL rebuild from every acquire listed in each source's `acquire.yaml`, in list order, which is chronological acquisition order. After the schema reset it SHALL run `data update`, in which every listed acquire is pending, and SHALL write to the database only through that `data update`. Each command it runs SHALL be its own command with its own folder and log. It SHALL preserve source dependency order, identities, corrections and standalone-source behavior. It SHALL NOT write `acquire.yaml` to choose a command's input; only an acquire it runs adds an entry. It SHALL reject a list whose last entry's output is missing and stop on a failed command. An acquire output that the list does not hold SHALL NOT be treated as a completed input.

#### Scenario: Older-only records survive

- **WHEN** an older listed acquire contains a record absent from the last listed acquire
- **THEN** the rebuilt database holds that record
- **AND** values a later acquire supplies for a matching record replace the earlier ones

#### Scenario: Superseded outputs were pruned

- **WHEN** an operator removed an older listed acquire's output while retaining its command audit descriptor
- **THEN** reset processes the remaining listed outputs
- **AND** it still requires the last listed output

#### Scenario: A snapshot fails

- **WHEN** a command reset runs fails
- **THEN** reset stops before later commands
- **AND** reset has written nothing to `acquire.yaml` but the entries of acquires it ran
