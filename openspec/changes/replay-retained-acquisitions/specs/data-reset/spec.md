## ADDED Requirements

### Requirement: Replay retained acquisition history

Reset SHALL process all retained acquisition outputs through each source's latest completed acquisition in chronological acquisition order. It SHALL transform, generate, and apply each output before advancing. It SHALL preserve source dependency order, identities, corrections and standalone-source behavior. It SHALL restore the original acquisition pointer on success or failure. It SHALL reject a missing latest acquisition and stop on a failed snapshot. Acquisition outputs newer than the latest completed pointer SHALL NOT be treated as completed inputs.

#### Scenario: Older-only records survive

- **WHEN** an older retained acquisition contains a record absent from the latest acquisition
- **THEN** reset imports that record before processing the latest acquisition
- **AND** later supplied values update matching records through normal import comparison

#### Scenario: Superseded outputs were pruned

- **WHEN** an operator removed an older acquisition output while retaining its command audit descriptor
- **THEN** reset processes the remaining retained outputs
- **AND** it still requires the latest completed output

#### Scenario: A snapshot fails

- **WHEN** transformation, generation, or application fails for an acquisition
- **THEN** reset stops before later acquisitions and restores the original acquisition pointer
