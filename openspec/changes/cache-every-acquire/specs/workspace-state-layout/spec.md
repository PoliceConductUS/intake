## MODIFIED Requirements

### Requirement: acquire.yaml lists a namespace's acquires

`state/<namespace>/acquire.yaml` SHALL hold `acquires`, the list of every successful acquire run of the namespace, each named by its output folder relative to the workspace, in command-folder-name order. It SHALL hold no key other than `acquires`; the last successful acquire is the list's last entry. It SHALL hold nothing about which acquires were processed.

#### Scenario: An acquire completes

- **WHEN** an acquire of a namespace completes
- **THEN** its output folder is added to the list in that namespace's `acquire.yaml`, in the place its command folder's name gives

#### Scenario: An acquire that does not complete

- **WHEN** a source's acquire module runs for a namespace and does not complete
- **THEN** that namespace's `acquire.yaml` does not change

#### Scenario: An old acquire.yaml

- **WHEN** a command reads an `acquire.yaml` that holds `latest`, `resume`, or any key other than `acquires`
- **THEN** the command exits non-zero naming that file
